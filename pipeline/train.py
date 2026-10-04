"""Training.

fit_procedure() is the whole modelling procedure: for every target, repeated nested CV per model
family, one-SE family selection, operating points and a final fit. Targets marked conditional_on
in manifest.yaml are modelled as P(parent) * P(target | parent).

Under the full_cv protocol, procedure_cv() first estimates how well that procedure generalises:
it reruns fit_procedure() inside each outer fold and predicts the held-out patients. Those
predictions are unbiased by model selection and are what pipeline.evaluate scores. The procedure
is then fitted on every patient to give the deployed models.

Run from the repo root: python -m pipeline.train
"""
import importlib.metadata as md
import json
import shutil
import subprocess
import sys
import time
from collections import Counter

import joblib
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.base import clone
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold

from pipeline import leakage
from pipeline.data import _strata, get_dev
from pipeline.metrics import bootstrap_ci, operating_points, point_metrics
from pipeline.models import FAMILIES, ProductModel, best_params, fitted_model, make_search, predict_pos
from pipeline.settings import MODELS_DIR, REPORTS_DIR, cfg, get_logger, manifest, protocol, seed, seed_all

log = get_logger(__name__)
STAGING = MODELS_DIR / "staging"
PREVIOUS = MODELS_DIR / "previous"
META = MODELS_DIR / "metadata.json"
PROCEDURE_OOF = REPORTS_DIR / "procedure_oof.csv"
DEV_OOF_NOTE = ("Out-of-fold predictions from the family-selection CV on all development patients. The family "
                "and threshold were chosen on these same predictions, so they are optimistic.")


def model_file(t) -> str:
    return manifest()["targets"][t].get("model") or f"{t}.joblib"


def target_order() -> list:
    """Targets with every parent before its children."""
    t = manifest()["targets"]
    roots = [k for k, s in t.items() if not s.get("conditional_on")]
    children = [k for k, s in t.items() if s.get("conditional_on")]
    for c in children:
        if t[c]["conditional_on"] not in roots:
            raise ValueError(f"{c}: conditional_on must name a target without its own parent")
    return roots + children


def _fit_predict(search, Xtr, ytr, Xte):
    return predict_pos(clone(search).fit(Xtr, ytr), Xte)


def _fit(search, X, y):
    return search.fit(X, y)


def summarize(oof, y, splits, S) -> dict:
    fold_auc = [roc_auc_score(y.iloc[te], oof[i // S, te]) for i, (tr, te) in enumerate(splits)]
    rep_auc = [roc_auc_score(y, oof[r]) for r in range(oof.shape[0])]
    rep_brier = [brier_score_loss(y, oof[r]) for r in range(oof.shape[0])]
    # Repeated folds reuse the same patients, so std/sqrt(k) understates the error and narrows the
    # one-SE band. Nadeau-Bengio correction: var * (1/k + n_test/n_train).
    se = float(np.sqrt((1 / len(fold_auc) + 1 / (S - 1)) * np.var(fold_auc, ddof=1)))
    return {"auc": float(np.mean(rep_auc)), "auc_sd": float(np.std(rep_auc)),
            "brier": float(np.mean(rep_brier)), "se": se}


def nested_cv(family, X, y, names, types=None) -> dict:
    """Single-target nested CV with folds stratified on that target (used by pipeline.external)."""
    c = cfg()["cv"]
    S, R = c["outer_splits"], c["outer_repeats"]
    splits = list(RepeatedStratifiedKFold(n_splits=S, n_repeats=R, random_state=seed()).split(X, y))
    base = make_search(family, names, types)
    preds = Parallel(n_jobs=c["n_jobs"])(
        delayed(_fit_predict)(base, X.iloc[tr], y.iloc[tr], X.iloc[te]) for tr, te in splits)
    oof = np.zeros((R, len(X)))
    for i, ((tr, te), p) in enumerate(zip(splits, preds)):
        oof[i // S, te] = p
    return {"oof": oof.mean(axis=0), **summarize(oof, y, splits, S)}


def select_family(results: dict) -> str:
    best = max(results, key=lambda f: results[f]["auc"])
    if not cfg()["cv"]["one_se_rule"]:
        return best
    floor = results[best]["auc"] - results[best]["se"]
    return next(f for f in FAMILIES if f in results and results[f]["auc"] >= floor)


def _oof_all(X, Y, names, splits, S) -> dict:
    """Out-of-fold predictions for every (target, family) in one parallel batch. Conditional targets
    are fitted on parent-positive training rows only; their predictions are multiplied by the
    parent's out-of-fold probability later, once the parent's family is chosen."""
    R = len(splits) // S
    jobs, keys = [], []
    for t in target_order():
        parent = manifest()["targets"][t].get("conditional_on")
        rows = (Y[parent] == 1).values if parent else None
        for f in FAMILIES:
            base = make_search(f, names)
            for i, (tr, te) in enumerate(splits):
                fit_rows = tr[rows[tr]] if rows is not None else tr
                jobs.append(delayed(_fit_predict)(base, X.iloc[fit_rows], Y[t].iloc[fit_rows], X.iloc[te]))
                keys.append((t, f, i))
    preds = Parallel(n_jobs=cfg()["cv"]["n_jobs"])(jobs)
    raw = {}
    for (t, f, i), p in zip(keys, preds):
        raw.setdefault((t, f), np.zeros((R, len(X))))[i // S, splits[i][1]] = p
    return raw


def fit_procedure(X, Y, names, repeats=None) -> dict:
    """The full modelling procedure on (X, Y), targets in parent-first order. Returns per target:
    kind, parent, family, results per family, out-of-fold probabilities, operating points and the
    fitted model (plus, for conditional targets, the fitted conditional part)."""
    c = cfg()["cv"]
    S = c["outer_splits"]
    splits = list(RepeatedStratifiedKFold(n_splits=S, n_repeats=repeats or c["outer_repeats"],
                                          random_state=seed()).split(X, _strata(Y)))
    raw = _oof_all(X, Y, names, splits, S)
    order, chosen, plan = target_order(), {}, {}
    for t in order:
        leakage.assert_clean(names, t)
        parent = manifest()["targets"][t].get("conditional_on")
        oofs = {f: raw[(t, f)] * (chosen[parent] if parent else 1) for f in FAMILIES}
        results = {f: summarize(o, Y[t], splits, S) for f, o in oofs.items()}
        fam = select_family(results)
        chosen[t] = oofs[fam]
        oof = oofs[fam].mean(axis=0)
        plan[t] = {"kind": "conditional" if parent else "direct", "parent": parent, "family": fam,
                   "results": results, "oof": oof, "ops": operating_points(Y[t].values, oof)}
    rows = {t: (Y[p["parent"]] == 1).values if p["parent"] else np.ones(len(X), bool) for t, p in plan.items()}
    searches = Parallel(n_jobs=min(len(order), 8))(
        delayed(_fit)(make_search(plan[t]["family"], names), X[rows[t]], Y[t][rows[t]]) for t in order)
    for t, search in zip(order, searches):
        p = plan[t]
        p["best_params"] = best_params(search)
        if p["parent"]:
            p["conditional"] = fitted_model(search)
            p["model"] = ProductModel(plan[p["parent"]]["model"], p["conditional"])
        else:
            p["conditional"], p["model"] = None, fitted_model(search)
    return plan


def _stratified_bootstrap(Y, rng) -> np.ndarray:
    strata = _strata(Y).to_numpy()
    return np.concatenate([rng.choice(np.flatnonzero(strata == s), size=int((strata == s).sum()))
                           for s in np.unique(strata)])


def _one_bag(fitted, X, Y, s) -> dict:
    idx = _stratified_bootstrap(Y, np.random.default_rng(s))
    Xb, Yb = X.iloc[idx], Y.iloc[idx]
    out = {}
    for t, f in fitted.items():
        if f["kind"] == "direct":
            out[t] = clone(f["model"]).fit(Xb, Yb[t])
        else:
            m = (Yb[f["parent"]] == 1).to_numpy()
            out[t] = ProductModel(out[f["parent"]], clone(f["conditional"]).fit(Xb[m], Yb[t][m]))
    return out


def bag_procedure(fitted, X, Y, n) -> dict:
    """Bootstrap refits of the chosen models with hyperparameters fixed, for per-prediction
    uncertainty. One bootstrap sample feeds every target, so each vessel member is paired with the
    CAD member fitted on the same patients."""
    seeds = np.random.default_rng(seed()).integers(0, 2**31 - 1, n)
    members = Parallel(n_jobs=cfg()["cv"]["n_jobs"])(delayed(_one_bag)(fitted, X, Y, int(s)) for s in seeds)
    return {t: [m[t] for m in members] for t in fitted}


def procedure_cv(X, Y, names) -> dict:
    """Unbiased performance of the whole procedure: rerun fit_procedure inside each outer fold and
    predict the held-out patients. Per target, arrays of shape (repeats, patients): probabilities,
    0/1 predictions at that fold's own threshold, and bootstrap interval widths."""
    v = cfg()["validation"]
    S, R = v["splits"], v["repeats"]
    outer = list(RepeatedStratifiedKFold(n_splits=S, n_repeats=R, random_state=seed() + 1).split(X, _strata(Y)))
    lo_q, hi_q = cfg()["uncertainty"]["interval"]
    order = target_order()
    P, C, W = ({t: np.full((R, len(X)), np.nan) for t in order} for _ in range(3))
    choices = {t: Counter() for t in order}
    for i, (tr, te) in enumerate(outer):
        Xtr, Ytr, Xte = X.iloc[tr], Y.iloc[tr], X.iloc[te]
        fitted = fit_procedure(Xtr, Ytr, names, repeats=v["selection_repeats"])
        bags = bag_procedure(fitted, Xtr, Ytr, v["eval_bag"]) if v["eval_bag"] else {}
        for t, f in fitted.items():
            p = predict_pos(f["model"], Xte)
            P[t][i // S, te] = p
            C[t][i // S, te] = (p >= f["ops"]["threshold"]).astype(float)
            if t in bags:
                members = np.column_stack([predict_pos(m, Xte) for m in bags[t]])
                W[t][i // S, te] = np.quantile(members, hi_q, axis=1) - np.quantile(members, lo_q, axis=1)
            choices[t][f["family"]] += 1
        log.info("procedure CV: outer fold %d/%d done", i + 1, len(outer))
    return {"P": P, "C": C, "W": W, "choices": {t: dict(c) for t, c in choices.items()}}


def write_procedure_oof(pcv, X, Y) -> None:
    rows = []
    for t, P in pcv["P"].items():
        for r in range(P.shape[0]):
            rows.append(pd.DataFrame({"patient_id": X.index, "repeat": r, "target": t, "y": Y[t].values,
                                      "p": P[r], "pred": pcv["C"][t][r], "width": pcv["W"][t][r]}))
    pd.concat(rows, ignore_index=True).to_csv(PROCEDURE_OOF, index=False)


def _dump(bundle, path) -> float:
    joblib.dump(bundle, path, compress=cfg()["models"]["compress"])
    return path.stat().st_size / 1e6


def save_bundle(t, bundle) -> float:
    """Write the staged bundle, halving the uncertainty bag until it fits under max_bundle_mb.
    Bag members are independent bootstrap refits, so dropping some is valid; it only coarsens
    the interval."""
    limit, floor = cfg()["models"]["max_bundle_mb"], cfg()["uncertainty"]["min_bag"]
    path = STAGING / model_file(t)
    size = _dump(bundle, path)
    while size > limit and len(bundle["bag"]) > floor:
        keep = max(floor, len(bundle["bag"]) // 2)
        log.warning("%s: bundle is %.0f MB (limit %d MB); trimming bag %d -> %d",
                    t, size, limit, len(bundle["bag"]), keep)
        bundle["bag"] = bundle["bag"][:keep]
        size = _dump(bundle, path)
    log.info("%s: bundle %.1f MB with %d bag members", t, size, len(bundle["bag"]))
    return size


def _py(o):
    if isinstance(o, dict):
        return {k: _py(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_py(v) for v in o]
    return o.item() if hasattr(o, "item") else o


def validate_staged(t, meta, X, names) -> None:
    limit = cfg()["models"]["max_bundle_mb"]
    if meta["bundle_mb"] > limit:
        raise ValueError(f"bundle is {meta['bundle_mb']} MB even at the minimum bag size (limit {limit} MB); "
                         "GitHub rejects files over 100 MB")
    bundle = joblib.load(STAGING / model_file(t))
    if bundle["features"] != names:
        raise ValueError("feature order mismatch")
    p = predict_pos(bundle["model"], X[names].head(5))
    if not (np.isfinite(p).all() and ((p >= 0) & (p <= 1)).all()):
        raise ValueError("invalid probabilities")
    if not (0 <= meta["rule_out"] <= meta["threshold"] <= meta["rule_in"] <= 1):
        raise ValueError("invalid operating points")


def _git_sha() -> str:
    """Commit the models were trained from; a -dirty suffix means uncommitted changes were present."""
    try:
        return subprocess.check_output(["git", "describe", "--always", "--dirty", "--abbrev=40"],
                                       cwd=MODELS_DIR.parent, stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return "unknown"


def promote(done: dict, names, X, sha) -> None:
    PREVIOUS.mkdir(parents=True, exist_ok=True)
    for t in done:
        dest = MODELS_DIR / model_file(t)
        if dest.exists():
            shutil.copy2(dest, PREVIOUS / dest.name)
        (STAGING / model_file(t)).replace(dest)
    libs = {p: md.version(p) for p in ["scikit-learn", "xgboost", "shap", "numpy", "pandas", "joblib"]}
    stats = {n: {"median": float(X[n].median()), "std": float(X[n].std()), "min": float(X[n].min()),
                 "max": float(X[n].max())} for n in names}
    meta = {"created": time.strftime("%Y-%m-%d %H:%M:%S"), "git_sha": _git_sha(), "data_sha256": sha,
            "protocol": protocol(), "n_patients": int(len(X)), "seed": seed(), "feature_order": names,
            "feature_stats": stats, "library_versions": libs,
            "targets": {t: {**m, "model_file": model_file(t)} for t, m in done.items()}}
    tmp = META.with_suffix(".tmp")
    tmp.write_text(json.dumps(_py(meta), indent=1), encoding="utf-8")
    tmp.replace(META)
    log.info("promoted %s", sorted(done))


def run(targets=None) -> None:
    if targets and set(targets) != set(manifest()["targets"]):
        raise SystemExit("all targets are trained together (the vessel models depend on CAD); run without arguments")
    seed_all()
    X, Y, sha = get_dev()
    names = list(X.columns)
    for d in (STAGING, REPORTS_DIR):
        d.mkdir(parents=True, exist_ok=True)
    try:
        choices = {}
        if protocol() == "full_cv":
            v = cfg()["validation"]
            log.info("procedure CV on %d patients: %d outer folds x %d repeats", len(X), v["splits"], v["repeats"])
            pcv = procedure_cv(X, Y, names)
            write_procedure_oof(pcv, X, Y)
            choices = pcv["choices"]
        log.info("fitting the procedure on all %d development patients", len(X))
        fitted = fit_procedure(X, Y, names)
        bags = bag_procedure(fitted, X, Y, cfg()["uncertainty"]["n_bag"])
        background = X.sample(n=min(cfg()["explain"]["background"], len(X)), random_state=seed())
        done = {}
        for t, f in fitted.items():
            y = Y[t]
            pd.DataFrame({fam: {k: v for k, v in r.items()} for fam, r in f["results"].items()}).T \
                .to_csv(REPORTS_DIR / f"dev_cv_{t}.csv", index_label="family")
            pd.DataFrame({"patient_id": X.index, "y": y.values, "p": f["oof"]}).to_csv(
                REPORTS_DIR / f"oof_{t}.csv", index=False)
            size = save_bundle(t, {"target": t, "features": names, "model": f["model"], "bag": bags[t],
                                   "background": background})
            thr = f["ops"]["threshold"]
            meta = _py({"kind": f["kind"], "parent": f["parent"], "family": f["family"],
                        "best_params": f["best_params"], "prevalence": float(y.mean()), **f["ops"],
                        "bundle_mb": round(size, 1), "n_bag": len(bags[t]), "dev_cv": f["results"],
                        "procedure_family_choices": choices.get(t, {}),
                        "dev_oof": {"note": DEV_OOF_NOTE, "threshold": thr,
                                    "metrics": point_metrics(y.values, f["oof"], thr),
                                    "ci": bootstrap_ci(y.values, f["oof"], thr)}})
            validate_staged(t, meta, X, names)
            done[t] = meta
            log.info("%s: %s %s | %s", t, f["kind"], f["family"],
                     {fam: round(r["auc"], 3) for fam, r in f["results"].items()})
        promote(done, names, X, sha)
    finally:
        shutil.rmtree(STAGING, ignore_errors=True)


if __name__ == "__main__":
    run(sys.argv[1:] or None)
