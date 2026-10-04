"""Decision curves, the CAD consistency check, the results report and the pipeline runner."""
import numpy as np

from pipeline import __main__ as runner
from pipeline import features, metrics, report


def test_decision_curve_perfect_model_gets_full_benefit():
    y = np.array([1] * 30 + [0] * 70)
    curve = metrics.decision_curve(y, y.astype(float), [0.1, 0.5, 0.9])
    assert all(abs(r["model"] - 0.3) < 1e-12 for r in curve)
    assert abs(curve[0]["treat_all"] - (0.3 - 0.7 * 0.1 / 0.9)) < 1e-12
    assert metrics.useful_range(curve) == [0.1, 0.9]


def test_decision_curve_useless_model_has_no_useful_range():
    y = np.array([1, 0] * 50)
    assert metrics.useful_range(metrics.decision_curve(y, np.full(100, 0.5), [0.6, 0.7])) is None


def test_cad_consistency_counts_patients_below_top_vessel():
    out = metrics.cad_consistency([0.9, 0.2, 0.5], [[0.5, 0.6, 0.5], [0.1, 0.1, 0.52]], tol=0.05)
    assert abs(out["share_below_top_vessel"] - 1 / 3) < 1e-12
    assert abs(out["max_gap"] - 0.4) < 1e-12


def test_report_builds_with_no_artefacts(tmp_path):
    text = report.build(report.Artefacts(tmp_path, tmp_path))
    assert text.startswith("# RiskAtlas")
    assert "python -m pipeline train" in text and "python -m pipeline evaluate" in text


def test_default_run_never_opens_a_locked_holdout(monkeypatch):
    monkeypatch.setattr(runner, "protocol", lambda: "holdout")
    assert "evaluate" not in runner.default_steps()
    monkeypatch.setattr(runner, "protocol", lambda: "full_cv")
    assert "evaluate" in runner.default_steps()


def test_every_feature_has_a_readable_label():
    assert all(f["label"] for f in features.registry())
