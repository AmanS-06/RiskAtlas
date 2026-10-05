"""SHAP explanations must be a pure function of (model bundle, input row, seed).

Background: shap's permutation explainer seeds numpy's GLOBAL RNG once in its constructor and then keeps drawing
from it, so the same patient got different SHAP values on every call, and concurrent calls interleaved their
draws (docs/backend_findings.md item 1, docs/shap_reproducibility.md). pipeline.explain.PermutationExplainer runs
the same algorithm with a private RandomState per row and no shared state.

Two groups of tests:
- toy model: always run, no trained models needed. They pin the algorithm to shap's own implementation.
- real models (models/*.joblib): determinism of the shipped explanations. Skipped when models are not trained.
"""
import json
import math
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import pytest
import shap

from pipeline import explain
from pipeline.models import predict_pos
from pipeline.settings import MODELS_DIR, REPORTS_DIR, ROOT

SEED = 42


@pytest.fixture(autouse=True)
def _keep_global_rng():
    """These tests deliberately tamper with numpy's global RNG; leave it as other tests expect it."""
    state = np.random.get_state()
    yield
    np.random.set_state(state)


def _same_state(a, b) -> bool:
    return a[0] == b[0] and np.array_equal(a[1], b[1]) and a[2:] == b[2:]


# ---------------------------------------------------------------------------------------------
# Toy model: the algorithm, independent of the trained models
# ---------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def toy():
    rng = np.random.RandomState(0)
    names = [f"f{i}" for i in range(6)]
    w = rng.randn(6)

    def fn(a):
        a = np.asarray(a, dtype=float)
        return 1 / (1 + np.exp(-(a @ w + 1.5 * a[:, 0] * a[:, 1] - a[:, 2] * a[:, 3] ** 2)))  # interactions

    return {"fn": fn, "bg": rng.randn(20, 6), "X": rng.randn(5, 6), "names": names, "evals": 2 * 6 * 5 + 1}


def _legacy(toy, seed, x):
    """What pipeline.explain did before the fix: shap's own explainer, global RNG freshly seeded, one row."""
    ex = shap.Explainer(toy["fn"], shap.maskers.Independent(toy["bg"], max_samples=len(toy["bg"])),
                        algorithm="permutation", seed=seed, feature_names=toy["names"])
    np.random.seed(seed)
    return ex(x[None, :], max_evals=toy["evals"], silent=True)


def test_matches_shap_permutation_explainer_bit_for_bit(toy):
    """Same algorithm as shap 0.51: with a freshly seeded global RNG the shap explainer gives exactly our numbers.
    If a shap upgrade changes its algorithm, this fails and the class in pipeline/explain.py must be reviewed."""
    ex = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], SEED)
    for x in toy["X"]:
        ref, new = _legacy(toy, SEED, x), ex(x[None, :], max_evals=toy["evals"])
        assert np.array_equal(ref.values, new.values)
        assert np.array_equal(ref.base_values, new.base_values)
        assert np.array_equal(ref.data, new.data)
        assert list(new.feature_names) == toy["names"]


def test_root_cause_shap_explainer_depends_on_global_rng_history(toy):
    """The bug this module fixes, on the toy model: shap's own explainer gives different values for the same row on
    consecutive calls, and gives the same values again once the global RNG is reseeded. If a shap upgrade makes this
    fail, shap fixed it upstream and PermutationExplainer can be reconsidered."""
    ex = shap.Explainer(toy["fn"], shap.maskers.Independent(toy["bg"], max_samples=len(toy["bg"])),
                        algorithm="permutation", seed=SEED, feature_names=toy["names"])
    x = toy["X"][:1]
    first, second = (ex(x, max_evals=toy["evals"], silent=True).values for _ in range(2))
    assert not np.array_equal(first, second)
    np.random.seed(SEED)
    third = ex(x, max_evals=toy["evals"], silent=True).values
    np.random.seed(SEED)
    assert np.array_equal(third, ex(x, max_evals=toy["evals"], silent=True).values)


def test_toy_calls_are_repeatable_and_do_not_touch_global_rng(toy):
    ex = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], SEED)
    before = np.random.get_state()
    first = ex(toy["X"], max_evals=toy["evals"]).values
    for _ in range(3):
        np.random.rand(7)  # unrelated consumers of the global RNG
        np.random.seed(int(np.random.randint(0, 2**31 - 1)))
        assert np.array_equal(first, ex(toy["X"], max_evals=toy["evals"]).values)
    np.random.set_state(before)
    ex(toy["X"], max_evals=toy["evals"])
    assert _same_state(before, np.random.get_state()), "explaining must not consume or reseed numpy's global RNG"


def test_row_explanation_does_not_depend_on_batch_or_position(toy):
    ex = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], SEED)
    batch = ex(toy["X"], max_evals=toy["evals"])
    for i, x in enumerate(toy["X"]):
        single = ex(x[None, :], max_evals=toy["evals"])
        assert np.array_equal(batch.values[i], single.values[0]) and batch.base_values[i] == single.base_values[0]
    reordered = ex(toy["X"][::-1], max_evals=toy["evals"])
    assert np.array_equal(reordered.values[::-1], batch.values)


def test_independent_rows_get_their_own_stream_and_stay_deterministic(toy):
    """The opt-in used by global_table: rows must not share permutations, yet the result is still a pure function
    of (seed, row position), repeatable and unaffected by the global RNG."""
    ex = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], SEED)
    same_patient = np.repeat(toy["X"][:1], 3, axis=0)
    shared = ex(same_patient, max_evals=toy["evals"]).values
    assert np.array_equal(shared[0], shared[1]) and np.array_equal(shared[0], shared[2])
    own = ex(same_patient, max_evals=toy["evals"], independent_rows=True)
    assert not np.array_equal(own.values[0], own.values[1]) and not np.array_equal(own.values[1], own.values[2])
    np.random.rand(11)
    again = ex(same_patient, max_evals=toy["evals"], independent_rows=True)
    assert np.array_equal(own.values, again.values) and np.array_equal(own.base_values, again.base_values)
    assert np.allclose(own.base_values[:, None] + own.values.sum(1)[:, None], toy["fn"](same_patient)[:, None])


def test_seed_is_honoured(toy):
    a = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], 1)(toy["X"], max_evals=toy["evals"]).values
    b = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], 1)(toy["X"], max_evals=toy["evals"]).values
    c = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], 2)(toy["X"], max_evals=toy["evals"]).values
    assert np.array_equal(a, b) and not np.array_equal(a, c)


def test_toy_is_additive_and_background_is_never_modified(toy):
    bg_before = toy["bg"].copy()
    ex = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], SEED)
    e = ex(toy["X"], max_evals=toy["evals"])
    assert np.allclose(e.base_values + e.values.sum(1), toy["fn"](toy["X"]), atol=1e-12)
    assert np.array_equal(bg_before, toy["bg"]) and np.array_equal(bg_before, ex._background)


def test_edge_cases(toy):
    ex = explain.PermutationExplainer(toy["fn"], toy["bg"], toy["names"], SEED)
    with pytest.raises(ValueError, match="too low"):
        ex(toy["X"][:1], max_evals=5)
    auto = ex(toy["X"][:1], max_evals="auto").values  # shap's own "auto" = 10 permutations
    assert np.array_equal(auto, ex(toy["X"][:1], max_evals=10 * 2 * 6).values)
    same = np.repeat(toy["bg"][:1], 20, axis=0)  # background identical to the row: nothing varies
    flat = explain.PermutationExplainer(toy["fn"], same, toy["names"], SEED)(toy["bg"][:1], max_evals=toy["evals"])
    assert np.array_equal(flat.values, np.zeros((1, 6))) and flat.base_values[0] == toy["fn"](toy["bg"][:1])[0]


# ---------------------------------------------------------------------------------------------
# Real models
# ---------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def ra():
    meta_file = MODELS_DIR / "metadata.json"
    if not meta_file.exists():
        pytest.skip("models not trained")
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    if not all((MODELS_DIR / m["model_file"]).exists() for m in meta["targets"].values()):
        pytest.skip("model files missing")
    from pipeline.predict import RiskAtlas
    return RiskAtlas()


@pytest.fixture(scope="module")
def rows(ra):
    """Median patient, the illustrative high-risk patient of reports/example_prediction.json, and a sparse record."""
    median = {n: s["median"] for n, s in ra.meta["feature_stats"].items()}
    sparse = {n: math.nan for n in ra.names}
    sparse.update(age=38, sex=0, bp=115)
    out = {"median": pd.DataFrame([median], columns=ra.names), "sparse": pd.DataFrame([sparse], columns=ra.names)}
    example = REPORTS_DIR / "example_prediction.json"
    if example.exists():
        out["example"] = pd.DataFrame([json.loads(example.read_text(encoding="utf-8"))["input"]], columns=ra.names)
    return out


@pytest.fixture(scope="module", params=["CAD", "LAD"])
def target(request, ra):
    """One overall target (calibrated model) and one vessel target (product model)."""
    return request.param, ra.bundles[request.param]


@pytest.fixture(scope="module")
def cad(ra):
    """The explanation code is model agnostic, so the tests that do not stress the model use CAD only."""
    return "CAD", ra.bundles["CAD"]


def test_repeated_calls_are_identical(ra, rows, target):
    t, b = target
    for name, row in rows.items():
        first = explain.shap_row(b, row, ra.explainers[t])
        for _ in range(2):
            assert explain.shap_row(b, row, ra.explainers[t]) == first, f"{t}/{name}: repeated calls differ"


def test_fresh_explainers_and_the_cached_one_agree(ra, rows, cad):
    t, b = cad
    row = rows["median"]
    cached = explain.shap_row(b, row, ra.explainers[t])
    assert explain.shap_row(b, row, explain.explainer_for(b)) == cached
    assert explain.shap_row(b, row, explain.explainer_for(b)) == cached
    assert explain.shap_row(b, row) == cached  # ex=None builds its own


def test_unrelated_random_calls_and_global_reseeding_change_nothing(ra, rows, cad):
    t, b = cad
    row, ex = rows["median"], ra.explainers[t]
    ref = explain.shap_row(b, row, ex)
    np.random.rand(1000)
    assert explain.shap_row(b, row, ex) == ref
    for s in (0, 7, SEED):
        np.random.seed(s)
        assert explain.shap_row(b, row, ex) == ref


def test_explaining_does_not_touch_the_global_rng(ra, rows, cad):
    """shap's constructor reseeded the global RNG and its call consumed it; ours must do neither."""
    t, b = cad
    np.random.seed(3)
    before = np.random.get_state()
    explain.explainer_for(b)
    explain.shap_row(b, rows["median"], ra.explainers[t])
    explain.shap_row(b, rows["median"])
    assert _same_state(before, np.random.get_state())


# Note: with several threads predicting at once, sklearn 1.8 (ColumnTransformer -> joblib's sequential path) emits
# "sklearn.utils.parallel.delayed should be used with Parallel" UserWarnings: each call does catch_warnings() plus
# resetwarnings() on the process-global warnings.filters, and a thread that captures the list meanwhile sees it empty.
# That is why a filterwarnings mark cannot silence them. It is unrelated to SHAP and has no numeric effect (the results
# below are compared bit for bit); the API's thread pool triggers it too.
def test_concurrent_calls_match_serial_without_lock_or_reseed(ra, rows, target):
    """8 threads share ONE explainer (as the API does) on mixed rows, while another thread hammers the global RNG,
    with a tiny thread switch interval to force interleaving. No lock, no reseeding."""
    t, b = target
    ex, frames = ra.explainers[t], list(rows.values())
    ref = [explain.shap_row(b, f, ex) for f in frames]
    n = 8
    barrier, stop = threading.Barrier(n), threading.Event()

    def worker(k):
        barrier.wait()
        return k % len(frames), explain.shap_row(b, frames[k % len(frames)], ex)

    def noise():
        while not stop.wait(0.0005):
            np.random.rand(5)
            np.random.seed(int(np.random.randint(0, 2**31 - 1)))

    old_interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-5)
    pest = threading.Thread(target=noise, daemon=True)
    pest.start()
    try:
        with ThreadPoolExecutor(n) as pool:
            out = list(pool.map(worker, range(n)))
    finally:
        stop.set()
        pest.join()
        sys.setswitchinterval(old_interval)
    for i, result in out:
        assert result == ref[i]


def test_shap_values_of_a_batch_equal_the_single_row_explanations(ra, rows, cad):
    t, b = cad
    frames = list(rows.values())
    batch = explain.shap_values(b, pd.concat(frames, ignore_index=True), ra.explainers[t])
    for i, frame in enumerate(frames):
        single = explain.shap_row(b, frame, ra.explainers[t])
        assert list(batch.values[i]) == list(single["contributions"].values())
        assert batch.base_values[i] == single["base"]


def test_every_target_is_additive_in_probability_space(ra, rows):
    for t, b in ra.bundles.items():
        for name, row in rows.items():
            s = explain.shap_row(b, row, ra.explainers[t])
            p = float(predict_pos(b["model"], row)[0])
            assert list(s["contributions"]) == ra.names
            assert math.isclose(s["base"] + sum(s["contributions"].values()), p, abs_tol=1e-6), f"{t}/{name}"


def test_predict_all_shap_is_stable_across_calls_and_threads(ra, rows):
    """The path the API uses: predict_all (SHAP only) once, then from 3 threads at once."""
    inputs = {n: float(v) for n, v in rows["median"].iloc[0].items()}
    kwargs = dict(counterfactuals=False, uncertainty=False)

    def shap_of(out):
        return {t: e["shap"] for t, e in out["targets"].items()}

    ref = shap_of(ra.predict_all(inputs, **kwargs))
    with ThreadPoolExecutor(3) as pool:
        for out in pool.map(lambda _: ra.predict_all(inputs, **kwargs), range(3)):
            assert shap_of(out) == ref


FRESH_PROCESS = """
import json, sys, joblib, pandas as pd
from pipeline import explain
from pipeline.settings import MODELS_DIR
meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
b = joblib.load(MODELS_DIR / meta["targets"]["CAD"]["model_file"])
row = pd.DataFrame([json.loads(sys.stdin.read())], columns=b["features"])
print(json.dumps(explain.shap_row(b, row)))
"""


def test_a_fresh_process_gives_the_same_numbers(ra, rows):
    """Different process, completely different call history, same explanation to the last bit."""
    row = {n: float(v) for n, v in rows["median"].iloc[0].items()}
    done = subprocess.run([sys.executable, "-c", FRESH_PROCESS], input=json.dumps(row), cwd=ROOT, text=True,
                          capture_output=True, timeout=300, env={**os.environ, "PYTHONPATH": str(ROOT)})
    assert done.returncode == 0, done.stderr[-2000:]
    assert json.loads(done.stdout.strip().splitlines()[-1]) == explain.shap_row(ra.bundles["CAD"], rows["median"],
                                                                                ra.explainers["CAD"])


def test_global_table_is_repeatable_and_writes_only_where_told(ra, monkeypatch, tmp_path):
    """global_table on a few real (background) patients. REPORTS_DIR is redirected: the committed
    reports/shap_global_*.csv must never be rewritten by a test."""
    committed = REPORTS_DIR / "shap_global_CAD.csv"
    before = committed.read_bytes() if committed.exists() else None
    base = explain.cfg()
    monkeypatch.setattr(explain, "REPORTS_DIR", tmp_path)
    monkeypatch.setattr(explain, "cfg", lambda: {**base, "explain": {**base["explain"], "global_rows": 3}})
    b, X = ra.bundles["CAD"], ra.bundles["CAD"]["background"]
    first = explain.global_table(b, X, ra.explainers["CAD"])
    np.random.rand(100)
    second = explain.global_table(b, X)
    pd.testing.assert_frame_equal(first, second, check_exact=True)
    assert (tmp_path / "shap_global_CAD.csv").exists()
    assert (committed.read_bytes() if committed.exists() else None) == before
    # the table is the mean |SHAP| of exactly those rows, explained with independent streams (an average over rows)
    rows3 = X[b["features"]].sample(n=3, random_state=explain.seed())
    expected = explain.shap_values(b, rows3, ra.explainers["CAD"], independent_rows=True).values
    assert np.array_equal(first.set_index("feature").loc[b["features"], "mean_abs_shap"].values,
                          np.abs(expected).mean(axis=0))
