"""Counterfactual search against stub models, so the behaviour is checked without trained models."""
import numpy as np
import pandas as pd

from pipeline import counterfactual, features
from pipeline.settings import cfg


class Stub:
    """Risk rises with blood pressure above 120 and with smoking; nothing else matters."""

    def predict_proba(self, X):
        z = 0.02 * (X["bp"].to_numpy() - 120) + 1.5 * X["current_smoker"].to_numpy() - 0.2
        p = 1 / (1 + np.exp(-z))
        return np.column_stack([1 - p, p])


class AgeOnly:
    """Risk driven only by age, which is immutable, so no plausible counterfactual exists."""

    def predict_proba(self, X):
        p = np.clip((X["age"].to_numpy() - 20) / 60, 0, 1)
        return np.column_stack([1 - p, p])


def _row(**over):
    vals = {}
    for f in features.active():
        vals[f["name"]] = float(np.mean(f["range"])) if f["range"] else 0.0
    vals.update(over)
    return pd.DataFrame([vals])


def _plan(model, row, goal=0.5):
    names = features.names()
    stats = {n: {"std": 1.0} for n in names}
    return counterfactual.plan(row, {"features": names, "model": model}, {"rule_in": goal}, stats)


def test_reaches_goal_using_only_mutable_features():
    out = _plan(Stub(), _row(bp=180.0, current_smoker=1.0, age=70.0, sex=1.0))
    changed = {c["feature"] for c in out["changes"]}
    mutable = {f["name"] for f in features.active() if f["mutable"]}
    assert out["needed"] and out["achieved"] and out["end"] < 0.5
    assert changed and changed <= mutable
    assert not changed & {"age", "sex"}
    assert len(out["changes"]) <= cfg()["counterfactual"]["max_changes"]


def test_numeric_changes_move_toward_the_reference_range_and_stop_there():
    out = _plan(Stub(), _row(bp=180.0, current_smoker=1.0))
    lo, hi = features.by_name()["bp"]["range"]
    for c in out["changes"]:
        if c["feature"] == "bp":
            assert hi <= c["to"] < c["from"]
            assert c["to"] >= lo


def test_reports_failure_when_only_immutable_factors_drive_risk():
    out = _plan(AgeOnly(), _row(age=75.0))
    assert out["needed"] and not out["achieved"] and out["changes"] == []


def test_no_change_needed_below_goal():
    out = _plan(Stub(), _row(bp=110.0, current_smoker=0.0))
    assert not out["needed"] and out["changes"] == []
