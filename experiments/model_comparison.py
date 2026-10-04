"""Model comparison that informed the final design. Writes reports/experiments/model_comparison.csv.

Runs on the ORIGINAL 242-patient development set (the locked holdout excluded), because that is the
data the design decisions were made on. Every approach uses the same repeated stratified CV folds.

Compared:
- direct models per vessel (logistic regression, random forest)
- hierarchical vessel models, P(vessel) = P(CAD) * P(vessel | CAD), with CAD from a random forest
- TabPFN v2 (Hollmann et al., Nature 2025), direct and hierarchical, if the optional `tabpfn`
  package is installed. It is not a project dependency: pip install tabpfn (pulls in PyTorch).
  Only model version 2 is used, because later versions require a gated licence login.

Run from the repo root: python experiments/model_comparison.py
"""
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.base import clone
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold

from pipeline.data import _strata, get_dev_split
from pipeline.models import make_search, predict_pos
from pipeline.settings import REPORTS_DIR, get_logger, seed

log = get_logger("experiments")
VESSELS = ["LAD", "LCX", "RCA"]
S, R = 5, 3


def sklearn_fold(X, Y, names, tr, te) -> dict:
    Xtr, Xte, Ytr = X.iloc[tr], X.iloc[te], Y.iloc[tr]
    pcad = predict_pos(clone(make_search("rf", names)).fit(Xtr, Ytr["CAD"]), Xte)
    out = {"CAD|rf": pcad,
           "CAD|lr": predict_pos(clone(make_search("lr", names)).fit(Xtr, Ytr["CAD"]), Xte)}
    pos = Ytr["CAD"].to_numpy() == 1
    for v in VESSELS:
        for fam in ("lr", "rf"):
            out[f"{v}|direct_{fam}"] = predict_pos(clone(make_search(fam, names)).fit(Xtr, Ytr[v]), Xte)
            cond = clone(make_search(fam, names)).fit(Xtr[pos], Ytr[v][pos])
            out[f"{v}|hierarchical_{fam}"] = pcad * predict_pos(cond, Xte)
    return out


def tabpfn_fold(X, Y, tr, te, threads) -> dict:
    import torch
    from tabpfn import TabPFNClassifier
    from tabpfn.constants import ModelVersion
    torch.set_num_threads(threads)
    mk = lambda: TabPFNClassifier.create_default_for_version(ModelVersion.V2, device="cpu", random_state=seed())
    Xtr, Xte, Ytr = X.iloc[tr].to_numpy(), X.iloc[te].to_numpy(), Y.iloc[tr]
    pcad = mk().fit(Xtr, Ytr["CAD"].to_numpy()).predict_proba(Xte)[:, 1]
    out = {"CAD|tabpfn_v2": pcad}
    pos = Ytr["CAD"].to_numpy() == 1
    for v in VESSELS:
        out[f"{v}|direct_tabpfn_v2"] = mk().fit(Xtr, Ytr[v].to_numpy()).predict_proba(Xte)[:, 1]
        cond = mk().fit(Xtr[pos], Ytr[v].to_numpy()[pos])
        out[f"{v}|hierarchical_tabpfn_v2"] = pcad * cond.predict_proba(Xte)[:, 1]
    return out


def collect(results, splits, Y) -> list:
    keys = results[0].keys()
    oof = {k: np.zeros((R, len(Y))) for k in keys}
    for i, ((tr, te), out) in enumerate(zip(splits, results)):
        for k, p in out.items():
            oof[k][i // S, te] = p
    rows = []
    for k in keys:
        t, approach = k.split("|")
        aucs = [roc_auc_score(Y[t], oof[k][r]) for r in range(R)]
        rows.append({"target": t, "approach": approach, "auc": float(np.mean(aucs)), "sd": float(np.std(aucs))})
    return rows


def main() -> None:
    X, Y, _ = get_dev_split()
    names = list(X.columns)
    splits = list(RepeatedStratifiedKFold(n_splits=S, n_repeats=R, random_state=seed()).split(X, _strata(Y)))
    log.info("sklearn approaches on %d development patients, %d folds", len(X), len(splits))
    rows = collect(Parallel(n_jobs=-1)(delayed(sklearn_fold)(X, Y, names, tr, te) for tr, te in splits), splits, Y)
    try:
        import tabpfn  # noqa: F401
        log.info("TabPFN v2 on the same folds (slow on CPU)")
        rows += collect(Parallel(n_jobs=5)(delayed(tabpfn_fold)(X, Y, tr, te, 4) for tr, te in splits), splits, Y)
    except ImportError:
        log.warning("tabpfn not installed; skipping TabPFN rows")
    out = REPORTS_DIR / "experiments"
    out.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows)
    df.to_csv(out / "model_comparison.csv", index=False)
    log.info("\n%s", df.pivot(index="approach", columns="target", values="auc").round(3).to_string())


if __name__ == "__main__":
    main()
