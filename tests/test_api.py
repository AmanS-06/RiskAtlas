"""API tests. Tests marked needs_models run the real trained models (models/*.joblib are committed);
mock, schema, CORS and error tests need no models."""
import copy
import json
import math
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import schemas, service
from api.main import create_app
from pipeline import features
from pipeline.settings import MODELS_DIR, REPORTS_DIR, ROOT, manifest, risk_bands, split_targets

HAVE_MODELS = (MODELS_DIR / "metadata.json").exists()
needs_models = pytest.mark.skipif(not HAVE_MODELS, reason="models not trained")
EXAMPLE = json.loads((REPORTS_DIR / "example_prediction.json").read_text(encoding="utf-8"))
LABELS = sorted({str(n) for n in manifest()["forbidden_features"]} | set(manifest()["targets"]))
HEAVY = {"uncertainty", "shap", "counterfactual"}


def keyshape(o):
    """Nested key structure, ignoring values. Lists contribute the union of their elements' keys."""
    if isinstance(o, dict):
        return {k: keyshape(v) for k, v in o.items()}
    if isinstance(o, list):
        merged = {}
        for item in o:
            shape = keyshape(item)
            if isinstance(shape, dict):
                merged.update(shape)
        return merged or None
    return None


@pytest.fixture(scope="module")
def mock_client():
    with TestClient(create_app(mock=True)) as c:
        yield c


@pytest.fixture(scope="module")
def client():
    if not HAVE_MODELS:
        pytest.skip("models not trained")
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("API_WARMUP", "0")
        with TestClient(create_app(mock=False)) as c:
            yield c


@pytest.fixture(scope="module")
def example_full(client):
    r = client.post("/predict", json=EXAMPLE["input"])
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def median_patient(client):
    return {f["name"]: f["stats"]["median"] for f in client.get("/meta").json()["features"]}


def check_error(r, status, code):
    assert r.status_code == status, r.text
    body = r.json()
    assert set(body) == {"error"} and body["error"]["code"] == code and body["error"]["message"]
    return body["error"]


# ---- health -----------------------------------------------------------------------------------------------

@needs_models
def test_health_real(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    assert body["status"] == "ok" and body["models_loaded"] is True and body["mock"] is False
    assert body["model"] == {"created": meta["created"], "git_sha": meta["git_sha"]}


# ---- /meta ------------------------------------------------------------------------------------------------

def check_meta_against_config(m):
    active = features.active()
    assert [f["name"] for f in m["features"]] == [f["name"] for f in active]
    for got, spec in zip(m["features"], active):
        for key in ("label", "type", "unit", "group", "mutable", "anchor", "map"):
            assert got[key] == spec[key], (spec["name"], key)
        assert (list(got["range"]) if got["range"] else None) == (list(spec["range"]) if spec["range"] else None)
    assert not {f["name"] for f in features.registry() if not f["use"]} & {f["name"] for f in m["features"]}
    spec_targets = manifest()["targets"]
    assert [t["id"] for t in m["targets"]] == list(spec_targets)
    overall, vessels = split_targets()
    for t in m["targets"]:
        spec = spec_targets[t["id"]]
        assert t["mesh"] == spec.get("mesh") and t["label"] == spec["label"]
        assert t["conditional_on"] == spec.get("conditional_on")
        assert t["kind"] == ("vessel" if t["id"] in vessels else "overall")
    assert m["risk_bands"] == [{"id": b["id"], "label": b["label"], "color": b["color"]} for b in risk_bands()]
    assert m["forbidden_inputs"] == manifest()["forbidden_features"]
    assert m["disclaimer"] == schemas.DISCLAIMER


@needs_models
def test_meta_real_matches_config_and_models(client):
    m = client.get("/meta").json()
    check_meta_against_config(m)
    meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    assert m["mock"] is False and m["model"]["git_sha"] == meta["git_sha"]
    for t in m["targets"]:
        for key in ("threshold", "rule_out", "rule_in"):
            assert t[key] == meta["targets"][t["id"]][key]
    for f in m["features"]:
        assert f["stats"] == meta["feature_stats"][f["name"]]
        if f["type"] == "binary":
            assert f["allowed"] == [0.0, 1.0]
    rwma = next(f for f in m["features"] if f["type"] == "categorical" and not f["map"])
    assert rwma["allowed"] == [float(i) for i in range(int(rwma["stats"]["min"]), int(rwma["stats"]["max"]) + 1)]


def test_meta_mock_matches_config(mock_client):
    m = mock_client.get("/meta").json()
    check_meta_against_config(m)
    assert m["mock"] is True and m["model"] is None
    assert all(t["rule_in"] is not None for t in m["targets"])


def test_request_schema_is_generated_from_features_yaml(mock_client):
    props = mock_client.get("/openapi.json").json()["components"]["schemas"]["PredictRequest"]["properties"]
    assert list(props) == features.names()
    assert list(schemas.PredictRequest.model_fields) == features.names()


# ---- /predict shape, disclaimer, additivity, coherence ------------------------------------------------------

@needs_models
def test_predict_shape_matches_example(example_full):
    expected = keyshape(EXAMPLE["output"])
    got = {k: v for k, v in keyshape(example_full).items() if k not in ("disclaimer", "mock")}
    assert got == expected
    assert set(example_full) == set(EXAMPLE["output"]) | {"disclaimer", "mock"}
    for t, ex in EXAMPLE["output"]["targets"].items():
        out = example_full["targets"][t]
        assert math.isclose(out["probability"], ex["probability"], abs_tol=1e-6) and out["band"] == ex["band"]
        for key in ("threshold", "rule_out", "rule_in"):
            assert math.isclose(out[key], ex[key], abs_tol=1e-9)
    assert example_full["input"] == {"missing": [], "ignored": []}
    assert example_full["mock"] is False
    assert example_full["model"]["git_sha"] != "mock"


@needs_models
def test_every_prediction_response_carries_the_disclaimer(client, example_full):
    fast = client.post("/predict/fast", json=EXAMPLE["input"]).json()
    assert example_full["disclaimer"] == fast["disclaimer"] == schemas.DISCLAIMER
    assert client.get("/meta").json()["disclaimer"] == schemas.DISCLAIMER


def test_disclaimer_text_is_the_readme_wording():
    readme = " ".join((ROOT / "README.md").read_text(encoding="utf-8").replace("> ", " ").split())
    assert schemas.DISCLAIMER in readme


@needs_models
def test_shap_is_additive_in_probability_space(client, example_full, median_patient):
    sparse = {k: v for k, v in list(median_patient.items())[:6]}
    stats = {f["name"]: f["stats"] for f in client.get("/meta").json()["features"]}
    extreme = {n: (s["median"] + 2 * s["std"] if s["max"] - s["min"] > 4 else s["median"]) for n, s in stats.items()}
    responses = [example_full] + [client.post("/predict", json=body).json() for body in (sparse, extreme)]
    for out in responses:
        for t in out["targets"].values():
            total = t["shap"]["base"] + sum(t["shap"]["contributions"].values())
            assert math.isclose(total, t["probability"], abs_tol=1e-6)
            assert set(t["shap"]["contributions"]) == set(features.names())


@needs_models
def test_vessel_probability_never_exceeds_parent(client, median_patient, example_full):
    meta = client.get("/meta").json()
    parents = {t["id"]: t["conditional_on"] for t in meta["targets"] if t["conditional_on"]}
    assert parents, "manifest defines no conditional targets"
    stats = {f["name"]: f["stats"] for f in meta["features"]}
    bodies = [{n: s["median"] + k * s["std"] for n, s in stats.items() if s["max"] - s["min"] > 4} for k in (-2, 0, 2)]
    bodies.append({})
    for body in bodies:
        probs = client.post("/predict/fast", json=body).json()["targets"]
        for child, parent in parents.items():
            assert probs[child]["probability"] <= probs[parent]["probability"] + 1e-9
    for c in example_full["coherence"].values():
        assert c["below_top_vessel"] is False and c["top_vessel"] in example_full["targets"]


# ---- /predict/fast ---------------------------------------------------------------------------------------

@needs_models
def test_fast_path_omits_heavy_parts(client, example_full):
    r = client.post("/predict/fast", json=EXAMPLE["input"])
    assert r.status_code == 200
    out = r.json()
    for t, full in example_full["targets"].items():
        assert set(out["targets"][t]) == {"probability", "band", "threshold", "rule_out", "rule_in"}
        assert math.isclose(out["targets"][t]["probability"], full["probability"], abs_tol=1e-9)
        assert out["targets"][t]["band"] == full["band"]
    assert {"coherence", "physiology", "input", "model", "timing_ms", "disclaimer", "mock"} <= set(out)
    assert out["timing_ms"]["shap"] == 0 and out["timing_ms"]["uncertainty"] == 0


@needs_models
def test_fast_path_is_fast(client):
    body = {**EXAMPLE["input"], "age": 51}
    client.post("/predict/fast", json=body)
    t0 = time.perf_counter()
    r = client.post("/predict/fast", json={**body, "age": 52})
    assert r.status_code == 200 and r.headers["X-Cache"] == "MISS"
    assert r.json()["timing_ms"]["total"] < 1000
    assert time.perf_counter() - t0 < 1.5


@needs_models
def test_identical_fast_requests_hit_the_cache(client):
    body = {**EXAMPLE["input"], "age": 49.5}
    del body["fbs"]
    first = client.post("/predict/fast", json=body)
    # Same values, different key order, and an explicit null for the feature the first request left out.
    shuffled = {**dict(reversed(list(body.items()))), "fbs": None}
    second = client.post("/predict/fast", json=shuffled)
    assert first.headers["X-Cache"] == "MISS" and second.headers["X-Cache"] == "HIT"
    a, b = first.json(), second.json()
    for out in (a, b):
        out.pop("timing_ms")
    assert a == b
    assert client.post("/predict/fast", json={**body, "age": 49.6}).headers["X-Cache"] == "MISS"


def test_lru_cache_evicts_oldest_and_zero_disables():
    c = service.LRUCache(2)
    c.put("a", 1), c.put("b", 2)
    assert c.get("a") == 1
    c.put("c", 3)
    assert c.get("b") is None and c.get("a") == 1 and c.get("c") == 3 and len(c) == 2
    off = service.LRUCache(0)
    off.put("a", 1)
    assert off.get("a") is None and len(off) == 0


def test_cache_key_ignores_order_and_nulls_but_not_values_or_unknown_keys():
    k = service.cache_key
    assert k({"age": 60, "bp": 120}) == k({"bp": 120, "age": 60.0}) == k({"bp": 120, "age": 60, "sex": None})
    assert k({"age": 60}) != k({"age": 61})
    assert k({"age": 60}) != k({"age": 60, "extra": 1})


@needs_models
def test_cache_hit_returns_an_independent_copy(client):
    engine = client.app.state.engine
    body = {"age": 47.25}
    first, _ = engine.predict(body, fast=True)
    first["targets"]["CAD"]["probability"] = -1
    first["input"]["missing"].clear()
    again, hit = engine.predict(body, fast=True)
    assert hit and again["targets"]["CAD"]["probability"] != -1 and again["input"]["missing"]


# ---- leakage ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("label", LABELS + [x.lower() for x in LABELS] + [x.upper() for x in LABELS])
def test_label_keys_are_rejected_with_422(mock_client, label):
    for path in ("/predict", "/predict/fast"):
        err = check_error(mock_client.post(path, json={"age": 60, label: 1}), 422, "leakage")
        assert label in err["message"] and err["details"][0]["field"] == label


@needs_models
@pytest.mark.parametrize("label", LABELS)
def test_label_keys_are_rejected_with_real_models(client, label):
    check_error(client.post("/predict", json={"age": 60, label: 1}), 422, "leakage")
    check_error(client.post("/predict/fast", json={label: None}), 422, "leakage")


def test_leakage_wins_over_other_validation_errors(mock_client):
    check_error(mock_client.post("/predict", json={"sex": 9, "LAD": 1}), 422, "leakage")


# ---- input handling -----------------------------------------------------------------------------------------

@needs_models
def test_missing_values_are_listed(client):
    out = client.post("/predict/fast", json={"age": 60, "bp": None, "sex": 1}).json()
    names = features.names()
    assert out["input"]["missing"] == [n for n in names if n not in ("age", "sex")]
    assert "bp" in out["input"]["missing"] and out["input"]["ignored"] == []
    assert out["physiology"]["bp"]["status"] == "missing" and out["physiology"]["bp"]["value"] is None


@needs_models
def test_empty_body_is_all_missing_but_valid(client):
    r = client.post("/predict/fast", json={})
    assert r.status_code == 200
    assert r.json()["input"]["missing"] == features.names()


@needs_models
def test_unknown_keys_are_listed_not_used(client):
    base = client.post("/predict/fast", json={"age": 60}).json()
    out = client.post("/predict/fast", json={"age": 60, "zzz_unknown": 5, "Another": "text"}).json()
    assert out["input"]["ignored"] == ["Another", "zzz_unknown"]
    for t in base["targets"]:
        assert out["targets"][t]["probability"] == base["targets"][t]["probability"]


@pytest.mark.parametrize("body,field", [
    ({"sex": 2}, "sex"),
    ({"dm": 0.5}, "dm"),
    ({"bbb": 3}, "bbb"),
    ({"vhd": -1}, "vhd"),
    ({"region_rwma": 1.5}, "region_rwma"),
    ({"age": "abc"}, "age"),
    ({"age": "inf"}, "age"),
    ({"bp": [120]}, "bp"),
])
def test_invalid_values_get_a_consistent_422(mock_client, body, field):
    err = check_error(mock_client.post("/predict", json=body), 422, "validation_error")
    assert field in [d["field"] for d in err["details"]]
    assert all({"field", "message"} <= set(d) for d in err["details"])


def test_malformed_body_gets_the_same_error_shape(mock_client):
    check_error(mock_client.post("/predict", json=[1, 2]), 422, "validation_error")
    check_error(mock_client.post("/predict", content=b"{not json", headers={"content-type": "application/json"}),
                422, "validation_error")


def test_unknown_route_and_wrong_method_use_the_error_shape(mock_client):
    check_error(mock_client.get("/nope"), 404, "not_found")
    check_error(mock_client.get("/predict"), 405, "method_not_allowed")


def test_unexpected_exception_becomes_a_500_without_a_traceback():
    app = create_app(mock=True)
    with TestClient(app, raise_server_exceptions=False) as c:
        def boom(*a, **k):
            raise RuntimeError("secret internals")
        app.state.engine.predict = boom
        r = c.post("/predict", json={})
        err = check_error(r, 500, "internal_error")
        assert "secret internals" not in json.dumps(err)


# ---- mock mode ------------------------------------------------------------------------------------------------

def test_mock_responses_are_flagged_everywhere(mock_client):
    health = mock_client.get("/health")
    assert health.json()["status"] == "mock" and health.json()["mock"] is True
    for r in (health, mock_client.get("/meta"), mock_client.post("/predict", json={}),
              mock_client.post("/predict/fast", json={})):
        assert r.status_code == 200
        assert r.json()["mock"] is True
        assert r.headers["X-RiskAtlas-Mock"] == "true"
    out = mock_client.post("/predict", json={}).json()
    assert out["model"] == {"created": "mock", "git_sha": "mock"}
    assert out["disclaimer"] == schemas.DISCLAIMER


def test_mock_serves_the_example_payload_shape(mock_client):
    out = mock_client.post("/predict", json=EXAMPLE["input"]).json()
    expected = keyshape(EXAMPLE["output"])
    assert {k: v for k, v in keyshape(out).items() if k not in ("disclaimer", "mock")} == expected
    for t, ex in EXAMPLE["output"]["targets"].items():
        assert out["targets"][t]["probability"] == ex["probability"]
        assert out["targets"][t]["shap"]["contributions"] == ex["shap"]["contributions"]
    fast = mock_client.post("/predict/fast", json={}).json()
    for t in fast["targets"].values():
        assert not HEAVY & set(t)


def test_mock_reports_missing_ignored_and_physiology_from_the_request(mock_client):
    out = mock_client.post("/predict/fast", json={"age": 60, "bp": 150, "whatever": 1}).json()
    assert "bp" not in out["input"]["missing"] and "age" not in out["input"]["missing"]
    assert out["input"]["ignored"] == ["whatever"]
    assert out["physiology"]["bp"]["status"] == "high" and out["physiology"]["bp"]["value"] == 150
    assert out["physiology"]["fbs"]["status"] == "missing"


@needs_models
def test_mock_physiology_matches_the_real_one(client, mock_client):
    body = {"bp": 85, "fbs": 95, "ldl": 140, "bmi": 22, "hb": 18}
    real = client.post("/predict/fast", json=body).json()["physiology"]
    mock = mock_client.post("/predict/fast", json=body).json()["physiology"]
    assert mock == real


def test_mock_mode_follows_the_environment(monkeypatch):
    seen = []
    monkeypatch.setattr("api.main.load_engine", lambda mock: seen.append(mock) or service.MockEngine.load())
    for value in ("1", "true", "0", ""):
        monkeypatch.setenv("API_MOCK", value)
        with TestClient(create_app()):
            pass
    assert seen == [True, True, False, False]


# ---- models not available ---------------------------------------------------------------------------------------

def test_missing_models_give_503_not_a_crash(monkeypatch, tmp_path):
    import pipeline.predict as pp
    monkeypatch.setattr(pp, "MODELS_DIR", tmp_path)
    with TestClient(create_app(mock=False)) as c:
        for r in (c.get("/meta"), c.post("/predict", json={}), c.post("/predict/fast", json={})):
            err = check_error(r, 503, "models_unavailable")
            assert "python -m pipeline train" in err["message"]
        health = c.get("/health")
        assert health.status_code == 503 and health.json()["status"] == "degraded"
        assert health.json()["models_loaded"] is False and health.json()["error"]


def test_model_mismatch_gives_503_with_a_retrain_hint(monkeypatch, tmp_path):
    import pipeline.predict as pp
    (tmp_path / "metadata.json").write_text(json.dumps({"feature_order": ["not_a_feature"], "targets": {}}))
    monkeypatch.setattr(pp, "MODELS_DIR", tmp_path)
    with TestClient(create_app(mock=False)) as c:
        err = check_error(c.post("/predict", json={"age": 60}), 503, "model_mismatch")
        assert "features.yaml" in err["message"] and "retrain" in err["message"].lower()
        assert c.get("/health").status_code == 503


# ---- CORS -----------------------------------------------------------------------------------------------------

def preflight(c, origin):
    return c.options("/predict", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                          "Access-Control-Request-Headers": "content-type"})


def test_cors_default_allows_only_the_vite_dev_origin(monkeypatch):
    monkeypatch.delenv("API_CORS_ORIGINS", raising=False)
    with TestClient(create_app(mock=True)) as c:
        ok = preflight(c, "http://localhost:5173")
        assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "http://localhost:5173"
        bad = preflight(c, "https://evil.example")
        assert "access-control-allow-origin" not in bad.headers
        r = c.get("/health", headers={"Origin": "http://localhost:5173"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_origins_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("API_CORS_ORIGINS", "https://app.example.com/, https://b.example")
    with TestClient(create_app(mock=True)) as c:
        assert preflight(c, "https://app.example.com").headers["access-control-allow-origin"] == "https://app.example.com"
        assert preflight(c, "https://b.example").status_code == 200
        assert "access-control-allow-origin" not in preflight(c, "http://localhost:5173").headers
    monkeypatch.setenv("API_CORS_ORIGINS", "*")
    with TestClient(create_app(mock=True)) as c:
        assert preflight(c, "https://anything.example").headers["access-control-allow-origin"] == "*"


# ---- concurrency ------------------------------------------------------------------------------------------------

def _stable(out):
    out = copy.deepcopy(out)
    out.pop("timing_ms")
    return out


@needs_models
def test_full_prediction_is_deterministic_and_safe_under_concurrency(client):
    """SHAP uses numpy's global RNG and a shared masker. The engine must make repeated and concurrent
    requests return the same explanation as a lone request."""
    engine = service.RealEngine(client.app.state.engine.ra, fast_cache=0, full_cache=0)  # no cache: really recompute
    a, b = {**EXAMPLE["input"], "age": 55.0}, {**EXAMPLE["input"], "age": 70.0, "bp": 110}
    serial_a = _stable(engine.predict(a, fast=False)[0])
    assert _stable(engine.predict(a, fast=False)[0]) == serial_a, "same request, different explanation"
    results, errors = {}, []

    def run(name, body, fast):
        try:
            results[name] = _stable(engine.predict(body, fast=fast)[0])
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=run, args=("a", a, False)), threading.Thread(target=run, args=("b", b, False)),
               threading.Thread(target=run, args=("fa", a, True)), threading.Thread(target=run, args=("fb", b, True))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert results["a"] == serial_a
    assert _stable(engine.predict(b, fast=False)[0]) == results["b"]
    for t in serial_a["targets"]:
        assert results["fa"]["targets"][t]["probability"] == serial_a["targets"][t]["probability"]


@needs_models
def test_a_slow_full_prediction_does_not_block_other_requests(client):
    done = threading.Event()
    body = {**EXAMPLE["input"], "age": 63.3, "ldl": 151}
    worker = threading.Thread(target=lambda: (client.post("/predict", json=body), done.set()))
    worker.start()
    try:
        time.sleep(0.3)
        t0 = time.perf_counter()
        health = client.get("/health")
        took = time.perf_counter() - t0
        still_running = not done.is_set()
        assert health.status_code == 200
        assert still_running, "the full prediction finished before /health was served; nothing was proven"
        assert took < 1.0, f"/health took {took:.2f} s while a full prediction was running"
        fast = client.post("/predict/fast", json={"age": 41.7})
        assert fast.status_code == 200 and not done.is_set()
    finally:
        worker.join()
