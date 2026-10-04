"""Data audit: what is in the dataset, before any modelling decision.

Descriptive only. Nothing here feeds model selection, so reading the full dataset (holdout
included) does not leak. Run from the repo root: python -m pipeline.audit
"""
import json

import pandas as pd

from pipeline import features
from pipeline.data import HOLDOUT_FILE, load_dataset, raw_path
from pipeline.settings import REPORTS_DIR, cfg, get_logger, split_targets

log = get_logger(__name__)


def feature_table(X: pd.DataFrame) -> pd.DataFrame:
    a = cfg()["audit"]
    rows = []
    for f in features.active():
        s = X[f["name"]]
        row = {"feature": f["name"], "label": f["label"], "type": f["type"], "unit": f["unit"],
               "n_unique": int(s.nunique()), "min": float(s.min()), "median": float(s.median()),
               "max": float(s.max())}
        if f["type"] == "binary":
            row["minority_share"] = float(min(s.mean(), 1 - s.mean()))
            row["flag_near_constant"] = row["minority_share"] < a["near_constant_share"]
        if f["range"]:
            lo, hi = f["range"]
            row.update(range_low=lo, range_high=hi,
                       share_below=float((s < lo).mean()), share_above=float((s > hi).mean()))
            row["flag_out_of_range"] = row["share_below"] + row["share_above"] > a["out_of_range_flag"]
        rows.append(row)
    return pd.DataFrame(rows)


def label_consistency(Y: pd.DataFrame) -> dict:
    overall, vessels = split_targets()
    stenotic = Y[vessels].max(axis=1)
    counts = Y[vessels].sum(axis=1).value_counts().sort_index()
    out = {"vessel_count_distribution": {int(k): int(v) for k, v in counts.items()}}
    for t in overall:
        a = (Y[t] == 1) & (stenotic == 0)
        b = (Y[t] == 0) & (stenotic == 1)
        out[t] = {"positive_without_stenotic_vessel": int(a.sum()),
                  "stenotic_vessel_without_positive": int(b.sum()),
                  "patient_ids": sorted(int(i) for i in Y.index[a | b])}
    return out


def prevalence(Y: pd.DataFrame) -> dict:
    out = {t: {"all": float(Y[t].mean())} for t in Y.columns}
    if HOLDOUT_FILE.exists():
        ids = json.loads(HOLDOUT_FILE.read_text(encoding="utf-8"))["holdout_ids"]
        dev = Y.drop(index=ids)
        for t in Y.columns:
            out[t].update(dev=float(dev[t].mean()), holdout=float(Y.loc[ids, t].mean()))
    return out


def build() -> tuple:
    X, Y, sha = load_dataset()
    table = feature_table(X)
    defined = features.registry()
    summary = {
        "data_sha256": sha,
        "n_patients": int(len(X)),
        "n_features_defined": len(defined),
        "n_features_active": int(X.shape[1]),
        "dropped_features": [f["name"] for f in defined if not f["use"]],
        "raw_missing_cells": int(pd.read_excel(raw_path(), sheet_name=0).isna().sum().sum()),
        "duplicate_patient_rows": int(X.duplicated().sum()),
        "holdout_size": len(json.loads(HOLDOUT_FILE.read_text(encoding="utf-8"))["holdout_ids"])
        if HOLDOUT_FILE.exists() else None,
        "prevalence": prevalence(Y),
        "label_consistency": label_consistency(Y),
        "target_correlation": Y.corr().round(3).to_dict(),
        "flags": {"near_constant": _flagged(table, "flag_near_constant"),
                  "out_of_range": _flagged(table, "flag_out_of_range")},
    }
    return summary, table


def _flagged(table: pd.DataFrame, col: str) -> list:
    # Rows without the flag (e.g. numeric features for near_constant) hold NaN, which is not True.
    return table.loc[table[col].eq(True), "feature"].tolist() if col in table else []


def run() -> dict:
    summary, table = build()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    table.to_csv(REPORTS_DIR / "data_audit_features.csv", index=False)
    (REPORTS_DIR / "data_audit.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    log.info("audit: %d patients, %d inputs; flags %s", summary["n_patients"], summary["n_features_active"],
             summary["flags"])
    return summary


if __name__ == "__main__":
    run()
