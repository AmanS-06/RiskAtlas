"""Metrics, bootstrap intervals, operating points and risk bands."""
import numpy as np
from sklearn.metrics import (accuracy_score, brier_score_loss, f1_score, precision_score,
                             recall_score, roc_auc_score, roc_curve)

from pipeline.settings import cfg, risk_bands, seed

KEYS = ["accuracy", "precision", "recall", "f1", "specificity", "roc_auc", "brier", "ece"]


def ece(y, p, bins) -> float:
    edges = np.quantile(p, np.linspace(0, 1, bins + 1)[1:-1])
    idx = np.digitize(p, edges)
    return float(sum((idx == b).mean() * abs(y[idx == b].mean() - p[idx == b].mean())
                     for b in range(bins) if (idx == b).any()))


def point_metrics(y, p, thr) -> dict:
    p = np.asarray(p)
    return metrics_from(y, p, (p >= thr).astype(int))


def repeated_metrics(y, P, C) -> dict:
    """Metrics averaged over CV repeats. P: probabilities, shape (repeats, n). C: 0/1 predictions
    at the threshold chosen inside each outer fold, same shape."""
    per = [metrics_from(y, P[r], C[r].astype(int)) for r in range(len(P))]
    return {k: float(np.nanmean([m[k] for m in per])) for k in KEYS}


def repeated_bootstrap_ci(y, P, C) -> dict:
    """95% CI by resampling patients, keeping each patient's predictions from every repeat together."""
    y, P, C = np.asarray(y), np.asarray(P), np.asarray(C)
    b = cfg()["bootstrap"]
    rng = np.random.default_rng(seed())
    draws = {k: [] for k in KEYS}
    for _ in range(b["n"]):
        idx = rng.integers(0, len(y), len(y))
        if y[idx].min() == y[idx].max():
            continue
        for k, v in repeated_metrics(y[idx], P[:, idx], C[:, idx]).items():
            draws[k].append(v)
    lo, hi = (1 - b["ci"]) / 2 * 100, (1 + b["ci"]) / 2 * 100
    return {k: [float(np.nanpercentile(v, lo)), float(np.nanpercentile(v, hi))] for k, v in draws.items()}


def metrics_from(y, p, pred) -> dict:
    y, p, pred = np.asarray(y), np.asarray(p), np.asarray(pred)
    neg = y == 0
    return {
        "accuracy": accuracy_score(y, pred),
        "precision": precision_score(y, pred, zero_division=0),
        "recall": recall_score(y, pred, zero_division=0),
        "f1": f1_score(y, pred, zero_division=0),
        "specificity": float((pred[neg] == 0).mean()) if neg.any() else float("nan"),
        "roc_auc": roc_auc_score(y, p),
        "brier": brier_score_loss(y, p),
        "ece": ece(y, p, cfg()["calibration"]["bins"]),
    }


def bootstrap_ci(y, p, thr) -> dict:
    y, p = np.asarray(y), np.asarray(p)
    b = cfg()["bootstrap"]
    rng = np.random.default_rng(seed())
    draws = {k: [] for k in KEYS}
    for _ in range(b["n"]):
        idx = rng.integers(0, len(y), len(y))
        if y[idx].min() == y[idx].max():
            continue
        for k, v in point_metrics(y[idx], p[idx], thr).items():
            draws[k].append(v)
    lo, hi = (1 - b["ci"]) / 2 * 100, (1 + b["ci"]) / 2 * 100
    return {k: [float(np.nanpercentile(v, lo)), float(np.nanpercentile(v, hi))] for k, v in draws.items()}


def operating_points(y, p) -> dict:
    """Youden threshold plus rule-out and rule-in cut points, all from out-of-fold data."""
    c = cfg()["operating_point"]
    fpr, tpr, thr = roc_curve(y, p)
    thr = np.clip(thr, 0.0, 1.0)
    youden = float(thr[np.argmax(tpr - fpr)])
    t_low = float(thr[tpr >= c["rule_out_sensitivity"]].max())
    t_high = float(thr[fpr <= 1 - c["rule_in_specificity"]].min())
    return {"threshold": youden, "rule_out": min(t_low, youden), "rule_in": max(t_high, youden)}


def decision_curve(y, p, thresholds) -> list:
    """Net benefit of acting on the model at each threshold probability, against treating
    everyone and treating no one (Vickers and Elkin, 2006)."""
    y, p = np.asarray(y), np.asarray(p)
    n, prev = len(y), float(y.mean())
    rows = []
    for t in thresholds:
        w = t / (1 - t)
        act = p >= t
        tp, fp = int((act & (y == 1)).sum()), int((act & (y == 0)).sum())
        rows.append({"threshold": float(t), "model": (tp - fp * w) / n,
                     "treat_all": prev - (1 - prev) * w, "treat_none": 0.0})
    return rows


def useful_range(curve) -> list:
    """[lowest, highest] threshold where the model beats both default strategies, or None."""
    good = [r["threshold"] for r in curve if r["model"] > max(r["treat_all"], r["treat_none"]) + 1e-9]
    return [min(good), max(good)] if good else None


def cad_consistency(p_overall, p_vessels, tol) -> dict:
    """CAD means stenosis in at least one vessel, so P(CAD) should not sit below the riskiest
    vessel. The targets are modelled separately, so this is a check, not a guarantee."""
    p_overall = np.asarray(p_overall, dtype=float)
    top = np.max(np.column_stack([np.asarray(v, dtype=float) for v in p_vessels]), axis=1)
    gap = top - p_overall
    below = gap > tol
    return {"n": int(len(gap)), "tolerance": tol, "share_below_top_vessel": float(below.mean()),
            "mean_gap_when_below": float(gap[below].mean()) if below.any() else 0.0,
            "max_gap": float(gap.max())}


def band(p: float, ops: dict) -> str:
    """Band id from risk_bands.yaml. Cut points are per target (rule_out / rule_in in metadata.json)."""
    low, mid, high = (b["id"] for b in risk_bands())
    return low if p < ops["rule_out"] else (high if p >= ops["rule_in"] else mid)
