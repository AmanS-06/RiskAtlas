"""Greedy counterfactuals: smallest set of plausible changes to mutable factors that lifts a vessel out of the high band."""
import numpy as np
import pandas as pd

from pipeline import features
from pipeline.models import predict_pos
from pipeline.settings import cfg

NOTE = "Model-based what-if. It describes associations in the training data, not proven effects of treatment."


def _options(f, value, steps):
    spec = features.by_name()[f]
    if np.isnan(value):
        return []
    if spec["type"] == "binary":
        return [0.0] if value == 1 else []
    if not spec["range"]:
        return []
    lo, hi = spec["range"]
    goal = hi if value > hi else (lo if value < lo else None)
    return [] if goal is None else sorted({float(value + s * (goal - value)) for s in steps})


def plan(row: pd.DataFrame, bundle: dict, ops: dict, stats: dict) -> dict:
    c, names, model = cfg()["counterfactual"], bundle["features"], bundle["model"]
    goal = ops["rule_in"]
    start = row[names].iloc[[0]].astype(float).reset_index(drop=True)
    cur, changes = start.copy(), {}
    p = float(predict_pos(model, cur)[0])
    out = {"goal_probability": goal, "start": p, "note": NOTE}
    if p < goal:
        return {**out, "needed": False, "achieved": True, "end": p, "changes": []}
    mutable = [f for f in names if features.by_name()[f]["mutable"]]
    while p >= goal and len(changes) < c["max_changes"]:
        cands = [(f, v) for f in mutable if f not in changes for v in _options(f, cur.at[0, f], c["steps"])]
        if not cands:
            break
        batch = pd.concat([cur] * len(cands), ignore_index=True)
        for i, (f, v) in enumerate(cands):
            batch.at[i, f] = v
        probs = predict_pos(model, batch)
        score = [(p - q) / (abs(v - cur.at[0, f]) / max(stats[f]["std"], 1e-9)) if q < p else -1
                 for (f, v), q in zip(cands, probs)]
        best = int(np.argmax(score))
        if score[best] <= 0:
            break
        f, v = cands[best]
        changes[f] = (float(cur.at[0, f]), v)
        cur.at[0, f] = v
        p = float(probs[best])
    if p < goal:
        for f in list(changes):
            trial = cur.copy()
            trial.at[0, f] = changes[f][0]
            q = float(predict_pos(model, trial)[0])
            if q < goal:
                cur, p = trial, q
                del changes[f]
    units = {f: features.by_name()[f]["unit"] for f in changes}
    return {**out, "needed": True, "achieved": bool(p < goal), "end": p,
            "changes": [{"feature": f, "unit": units[f], "from": a, "to": b} for f, (a, b) in changes.items()]}


def run() -> dict:
    """Run plan() over high-band development patients and summarise how often a plausible
    counterfactual exists and what it changes. Run from the repo root: python -m pipeline.counterfactual"""
    import json
    from collections import Counter

    import joblib

    from pipeline.data import get_dev
    from pipeline.settings import MODELS_DIR, REPORTS_DIR, get_logger, seed
    log = get_logger(__name__)
    meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    X, _, _ = get_dev()
    limit = cfg()["counterfactual"]["eval_max_patients"]
    rows, summary = [], {}
    for t, m in meta["targets"].items():
        b = joblib.load(MODELS_DIR / m["model_file"])
        p = predict_pos(b["model"], X[b["features"]])
        high = X.index[p >= m["rule_in"]]
        rng = np.random.default_rng(seed())
        sample = sorted(rng.choice(high, size=min(limit, len(high)), replace=False)) if len(high) else []
        for pid in sample:
            res = plan(X.loc[[pid]], b, m, meta["feature_stats"])
            rows.append({"target": t, "patient_id": int(pid), "start": res["start"], "end": res["end"],
                         "achieved": res["achieved"], "n_changes": len(res["changes"]),
                         "features": ",".join(c["feature"] for c in res["changes"])})
        done = [r for r in rows if r["target"] == t]
        hit = [r for r in done if r["achieved"]]
        used = Counter(f for r in hit for f in r["features"].split(",") if f)
        summary[t] = {"n_dev": int(len(X)), "n_high_band": int(len(high)), "n_evaluated": len(done),
                      "achieved_share": len(hit) / len(done) if done else None,
                      "mean_changes_when_achieved": float(np.mean([r["n_changes"] for r in hit])) if hit else None,
                      "most_changed": [{"feature": f, "label": features.by_name()[f]["label"], "count": c}
                                       for f, c in used.most_common(5)]}
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(REPORTS_DIR / "counterfactuals.csv", index=False)
    note = (NOTE + " Evaluated on development patients the model was trained on, so this describes the "
            "model's behaviour, not out-of-sample performance.")
    (REPORTS_DIR / "counterfactuals_summary.json").write_text(json.dumps({"note": note, "targets": summary},
                                                                         indent=1), encoding="utf-8")
    log.info("counterfactuals: %s", {t: s["achieved_share"] for t, s in summary.items()})
    return summary


if __name__ == "__main__":
    run()
