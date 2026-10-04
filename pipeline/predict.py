"""One-call inference: probabilities, uncertainty, bands, SHAP, physiology and counterfactuals.

predict_all() is the full payload for /predict. predict_fast() returns probabilities and bands
only, for live what-if sliders. Every response carries timing_ms.
Benchmark from the repo root: python -m pipeline.predict
"""
import json
import math
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from pipeline import counterfactual, explain, features, leakage
from pipeline.metrics import band
from pipeline.models import predict_pos
from pipeline.settings import MODELS_DIR, cfg, get_logger, split_targets


class ModelMismatch(RuntimeError):
    pass


class RiskAtlas:
    def __init__(self, models_dir=None):
        self.dir = Path(models_dir or MODELS_DIR)
        self.meta = json.loads((self.dir / "metadata.json").read_text(encoding="utf-8"))
        self.names = features.names()
        if self.meta["feature_order"] != self.names:
            raise ModelMismatch("model feature order differs from features.yaml; retrain")
        self.bundles, self.explainers = {}, {}
        for t, m in self.meta["targets"].items():
            b = joblib.load(self.dir / m["model_file"])
            if b["features"] != self.names:
                raise ModelMismatch(f"{t}: bundle feature order differs from features.yaml")
            self.bundles[t] = b
            self.explainers[t] = explain.explainer_for(b)

    def _row(self, inputs: dict):
        leakage.assert_clean(inputs.keys())
        ignored = sorted(k for k in inputs if k not in self.names)
        vals = {n: (float(inputs[n]) if inputs.get(n) is not None else math.nan) for n in self.names}
        missing = [n for n in self.names if math.isnan(vals[n])]
        return pd.DataFrame([vals], columns=self.names), missing, ignored

    def physiology(self, row: pd.DataFrame) -> dict:
        out = {}
        for f in features.active():
            if f["range"]:
                v = float(row.at[0, f["name"]])
                lo, hi = f["range"]
                status = "missing" if math.isnan(v) else ("low" if v < lo else "high" if v > hi else "normal")
                out[f["name"]] = {"label": f["label"], "value": None if math.isnan(v) else v, "unit": f["unit"],
                                  "range": [lo, hi], "status": status}
        return out

    def coherence(self, targets: dict) -> dict:
        """CAD means stenosis in at least one vessel, but the targets are modelled separately, so
        P(CAD) can sit below the riskiest vessel. Flag it so the UI can explain it, not hide it."""
        overall, vessels = split_targets()
        tol = cfg()["analysis"]["consistency_tolerance"]
        out = {}
        for t in overall:
            probs = {v: targets[v]["probability"] for v in vessels if v in targets}
            if t in targets and probs:
                top = max(probs, key=probs.get)
                gap = probs[top] - targets[t]["probability"]
                out[t] = {"top_vessel": top, "gap": gap, "below_top_vessel": bool(gap > tol)}
        return out

    def predict_all(self, inputs: dict, explain_shap=True, counterfactuals=True, uncertainty=True) -> dict:
        start = time.perf_counter()
        spent = {"uncertainty": 0.0, "shap": 0.0, "counterfactual": 0.0}
        row, missing, ignored = self._row(inputs)
        lo_q, hi_q = cfg()["uncertainty"]["interval"]
        targets = {}
        for t, b in self.bundles.items():
            ops = self.meta["targets"][t]
            p = float(predict_pos(b["model"], row)[0])
            entry = {"probability": p, "band": band(p, ops), "threshold": ops["threshold"],
                     "rule_out": ops["rule_out"], "rule_in": ops["rule_in"]}
            if uncertainty:
                t0 = time.perf_counter()
                members = np.array([predict_pos(m, row)[0] for m in b["bag"]])
                low, high = (float(np.quantile(members, q)) for q in (lo_q, hi_q))
                entry["uncertainty"] = {"std": float(members.std()), "low": low, "high": high, "width": high - low}
                spent["uncertainty"] += time.perf_counter() - t0
            if explain_shap:
                t0 = time.perf_counter()
                entry["shap"] = explain.shap_row(b, row, self.explainers[t])
                spent["shap"] += time.perf_counter() - t0
            if counterfactuals:
                t0 = time.perf_counter()
                entry["counterfactual"] = counterfactual.plan(row, b, ops, self.meta["feature_stats"])
                spent["counterfactual"] += time.perf_counter() - t0
            targets[t] = entry
        timing = {k: round(v * 1000, 1) for k, v in spent.items()}
        timing["total"] = round((time.perf_counter() - start) * 1000, 1)
        return {"targets": targets, "coherence": self.coherence(targets), "physiology": self.physiology(row),
                "input": {"missing": missing, "ignored": ignored},
                "model": {"created": self.meta["created"], "git_sha": self.meta["git_sha"]},
                "timing_ms": timing}

    def predict_fast(self, inputs: dict) -> dict:
        """For live what-if sliders: probabilities and bands only.

        The uncertainty bag is the slowest part (one call per bag member per target), slower
        even than SHAP, so it is skipped here too. Call this while a slider is dragged and
        predict_all() when it is released."""
        return self.predict_all(inputs, explain_shap=False, counterfactuals=False, uncertainty=False)


def benchmark(runs=5) -> dict:
    """Median end-to-end latency in ms for a median patient, full and fast paths."""
    ra = RiskAtlas()
    row = {n: s["median"] for n, s in ra.meta["feature_stats"].items()}
    out = {}
    for label, call in (("full", ra.predict_all), ("fast", ra.predict_fast)):
        call(row)  # warm-up, excluded from the median
        out[label] = float(np.median([call(row)["timing_ms"]["total"] for _ in range(runs)]))
    return out


if __name__ == "__main__":
    log = get_logger(__name__)
    for label, ms in benchmark().items():
        log.info("%s: median %.0f ms per request", label, ms)
