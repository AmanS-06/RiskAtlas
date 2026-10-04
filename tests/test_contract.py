import math

import pytest

from pipeline import leakage
from pipeline.settings import MODELS_DIR, risk_bands

pytestmark = pytest.mark.skipif(not (MODELS_DIR / "metadata.json").exists(), reason="models not trained")


@pytest.fixture(scope="module")
def ra():
    from pipeline.predict import RiskAtlas
    return RiskAtlas()


def _median_patient(ra):
    return {n: s["median"] for n, s in ra.meta["feature_stats"].items()}


def test_predict_all_contract(ra):
    out = ra.predict_all(_median_patient(ra))
    band_ids = {b["id"] for b in risk_bands()}
    assert set(out["targets"]) == set(ra.meta["targets"])
    for t in out["targets"].values():
        assert 0.0 <= t["probability"] <= 1.0 and t["band"] in band_ids
        assert 0.0 <= t["uncertainty"]["low"] <= t["uncertainty"]["high"] <= 1.0
        total = t["shap"]["base"] + sum(t["shap"]["contributions"].values())
        assert math.isclose(total, t["probability"], abs_tol=1e-6)
    assert out["timing_ms"]["total"] > 0
    for c in out["coherence"].values():
        assert c["top_vessel"] in out["targets"] and isinstance(c["below_top_vessel"], bool)


def test_vessels_never_exceed_cad(ra):
    from pipeline.settings import split_targets
    overall, vessels = split_targets()
    stats = ra.meta["feature_stats"]
    for shift in (-2, 0, 2):
        out = ra.predict_fast({n: s["median"] + shift * s["std"] for n, s in stats.items()})
        for o in overall:
            for v in vessels:
                if ra.meta["targets"][v].get("parent") == o:
                    assert out["targets"][v]["probability"] <= out["targets"][o]["probability"] + 1e-9


def test_predict_fast_skips_heavy_parts(ra):
    out = ra.predict_fast(_median_patient(ra))
    for t in out["targets"].values():
        assert {"probability", "band"} <= set(t)
        assert not {"shap", "counterfactual", "uncertainty"} & set(t)


def test_predict_all_rejects_label_inputs(ra):
    with pytest.raises(leakage.LeakageError):
        ra.predict_all({"age": 50, "LAD": 1})


def test_missing_inputs_are_reported(ra):
    out = ra.predict_fast({"age": 60})
    assert "bp" in out["input"]["missing"]
