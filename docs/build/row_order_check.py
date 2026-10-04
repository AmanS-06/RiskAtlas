"""Check whether the row order of the raw spreadsheet is associated with the outcome labels.

    python docs/build/row_order_check.py [path/to/xlsx]     # default: the first *.xlsx in data/raw/

Writes docs/build/row_order_check.json. This is the documentation author's own check, not part of the ML
reports. It needs the raw dataset (not committed; see README, 'Retrain').
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[2]
path = Path(sys.argv[1]) if len(sys.argv) > 1 else sorted((ROOT / "data" / "raw").glob("*.xlsx"))[0]
df = pd.read_excel(path)
df.columns = [str(c).strip() for c in df.columns]
pos = np.arange(len(df))
spec = {"CAD": ("Cath", "CAD"), "LAD": ("LAD", "Stenotic"), "LCX": ("LCX", "Stenotic"), "RCA": ("RCA", "Stenotic")}
out = {"n": int(len(df)), "note": "AUC of row position as a score for the positive label; 0.5 means row order carries no information"}
for t, (col, val) in spec.items():
    y = (df[col].astype(str).str.strip().str.upper() == val.upper()).astype(int)
    rho, p = spearmanr(pos, y)
    out[t] = {"auc_of_row_position": round(float(roc_auc_score(y, pos)), 3), "spearman_rho": round(float(rho), 3),
              "p_value": float(f"{p:.3g}")}
(ROOT / "docs" / "build" / "row_order_check.json").write_text(json.dumps(out, indent=1) + "\n")
print(json.dumps(out, indent=1))
