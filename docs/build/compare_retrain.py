"""Compare a retrained copy of the repository with the committed models and reports.

    # 1. retrain in a clean copy (needs the dataset in data/raw/):  python -m pipeline
    # 2. from the committed checkout:
    python docs/build/compare_retrain.py /path/to/retrained/copy

Writes docs/build/retrain_check.json: whether the data hash and chosen families match, the largest difference
in the headline ROC-AUC and Brier point estimates, and the largest difference between the two sets of final
models' probabilities on 30 random inputs (both loaded through pipeline.predict.RiskAtlas).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
other = Path(sys.argv[1]).resolve()

PROBE = r"""
import json, sys, numpy as np
from pipeline.predict import RiskAtlas
ra = RiskAtlas()
stats = ra.meta["feature_stats"]
rng = np.random.default_rng(0)
out = []
for _ in range(30):
    x = {n: float(np.clip(s["median"] + rng.normal() * s["std"], s["min"], s["max"])) for n, s in stats.items()}
    for n, s in stats.items():
        if s["min"] == 0 and s["max"] == 1:
            x[n] = float(rng.integers(0, 2))
    r = ra.predict_fast(x)
    out.append([r["targets"][t]["probability"] for t in ["CAD", "LAD", "LCX", "RCA"]])
print(json.dumps(out))
"""


def probe(root: Path):
    env = {**os.environ, "RISKATLAS_ROOT": str(root), "PYTHONPATH": str(root), "API_WARMUP": "0"}
    out = subprocess.run([sys.executable, "-c", PROBE], cwd=root, env=env, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def metrics(root: Path):
    m = pd.read_csv(root / "reports" / "performance_metrics.csv")
    return {(r.target, r.metric): r.estimate for r in m.itertuples()}


ma = json.loads((ROOT / "models" / "metadata.json").read_text())
mb = json.loads((other / "models" / "metadata.json").read_text())
a, b = metrics(ROOT), metrics(other)
pa, pb = probe(ROOT), probe(other)
res = {
    "retrained_models_created": mb["created"],
    "committed_models_created": ma["created"],
    "same_data_sha256": ma["data_sha256"] == mb["data_sha256"],
    "same_family": {t: ma["targets"][t]["family"] == mb["targets"][t]["family"] for t in ma["targets"]},
    "max_abs_diff_cut_points": max(abs(ma["targets"][t][k] - mb["targets"][t][k])
                                   for t in ma["targets"] for k in ("threshold", "rule_out", "rule_in")),
    "roc_auc_committed_vs_retrained": {t: [round(a[(t, "roc_auc")], 4), round(b[(t, "roc_auc")], 4)] for t in ma["targets"]},
    "max_abs_diff_headline_roc_auc": round(max(abs(a[(t, "roc_auc")] - b[(t, "roc_auc")]) for t in ma["targets"]), 4),
    "max_abs_diff_any_headline_metric": round(max(abs(a[k] - b[k]) for k in a), 4),
    "max_abs_diff_final_model_probabilities_30_random_inputs": max(abs(x - y) for r1, r2 in zip(pa, pb) for x, y in zip(r1, r2)),
}
(ROOT / "docs" / "build" / "retrain_check.json").write_text(json.dumps(res, indent=1) + "\n")
print(json.dumps(res, indent=1))
