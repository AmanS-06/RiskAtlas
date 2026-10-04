"""The hierarchical vessel model, repeated-CV metrics, and the procedure-level cross-validation."""
import numpy as np
import pandas as pd
import pytest

from pipeline import metrics, train
from pipeline.models import ProductModel


class Const:
    def __init__(self, p):
        self.p = np.asarray(p, dtype=float)

    def predict_proba(self, X):
        p = np.resize(self.p, len(X))
        return np.column_stack([1 - p, p])


def test_product_model_never_exceeds_its_parent():
    parent, cond = Const([0.9, 0.4, 0.1]), Const([0.5, 1.0, 0.7])
    proba = ProductModel(parent, cond).predict_proba(pd.DataFrame({"a": [0, 0, 0]}))
    assert np.allclose(proba.sum(axis=1), 1)
    assert np.allclose(proba[:, 1], [0.45, 0.4, 0.07])
    assert (proba[:, 1] <= parent.predict_proba(np.zeros(3))[:, 1] + 1e-12).all()


def test_repeated_metrics_match_point_metrics_for_identical_repeats():
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 80)
    p = np.clip(0.4 * y + 0.6 * rng.random(80), 0, 1)
    P = np.vstack([p, p])
    C = (P >= 0.5).astype(float)
    rep, point = metrics.repeated_metrics(y, P, C), metrics.point_metrics(y, p, 0.5)
    assert all(abs(rep[k] - point[k]) < 1e-12 for k in metrics.KEYS)


def test_target_order_puts_parents_first():
    order = train.target_order()
    assert order.index("CAD") < min(order.index(v) for v in ("LAD", "LCX", "RCA"))


def test_procedure_cv_never_trains_on_its_test_patients(monkeypatch):
    rng = np.random.default_rng(0)
    n = 150
    X = pd.DataFrame({"age": rng.normal(60, 10, n)}, index=pd.RangeIndex(1000, 1000 + n))
    lad = rng.integers(0, 2, n)
    Y = pd.DataFrame({"CAD": np.maximum(lad, rng.integers(0, 2, n)), "LAD": lad,
                      "LCX": rng.integers(0, 2, n) * lad, "RCA": rng.integers(0, 2, n) * lad}, index=X.index)
    seen = []

    def fake_fit(Xtr, Ytr, names, repeats=None):
        seen.append(set(Xtr.index))
        return {t: {"model": Const([0.5]), "ops": {"threshold": 0.5}, "family": "lr"} for t in Y.columns}

    monkeypatch.setattr(train, "fit_procedure", fake_fit)
    monkeypatch.setattr(train, "bag_procedure", lambda *a, **k: {})
    monkeypatch.setattr(train, "target_order", lambda: list(Y.columns))
    out = train.procedure_cv(X, Y, ["age"])
    v = train.cfg()["validation"]
    assert len(seen) == v["splits"] * v["repeats"]
    for t, P in out["P"].items():
        assert P.shape == (v["repeats"], n) and np.isfinite(P).all()
    # every patient is held out exactly once per repeat, so it is missing from exactly one training set per repeat
    per_repeat = [seen[r * v["splits"]:(r + 1) * v["splits"]] for r in range(v["repeats"])]
    for folds in per_repeat:
        held_out = [set(X.index) - s for s in folds]
        assert sum(len(h) for h in held_out) == n and set().union(*held_out) == set(X.index)


@pytest.mark.parametrize("bad", [{"conditional_on": "LAD"}])
def test_target_order_rejects_nested_parents(monkeypatch, bad):
    fake = {"CAD": {}, "LAD": {"conditional_on": "CAD"}, "LCX": bad}
    monkeypatch.setattr(train, "manifest", lambda: {"targets": fake})
    with pytest.raises(ValueError):
        train.target_order()
