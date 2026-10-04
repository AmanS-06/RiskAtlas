"""Final evaluation. Writes every reported performance number to reports/.

full_cv protocol (default): scores the procedure-CV predictions written by pipeline.train, where
every outer fold redid family selection, tuning, calibration and thresholds on its training part
only. Output: performance_metrics.csv, validation_summary.json, subgroups.csv, plots.

holdout protocol: opens the locked holdout (see pipeline.data.open_holdout) and scores it.
Output: holdout_metrics.csv, holdout_summary.json, subgroups.csv, plots.
"""
import hashlib
import json

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.calibration import calibration_curve

from pipeline.analysis import consistency_report, dca_report, plot_dca
from pipeline.data import get_dev, open_holdout
from pipeline.metrics import KEYS, bootstrap_ci, point_metrics, repeated_bootstrap_ci, repeated_metrics
from pipeline.models import predict_pos
from pipeline.settings import MODELS_DIR, REPORTS_DIR, cfg, get_logger, protocol, seed_all

log = get_logger(__name__)
NOTES = {
    "ece": ("Expected calibration error with quantile bins. At this sample size each bin holds few patients, "
            "so treat it as indicative only; the calibration plots are more informative."),
    "uncertainty": ("Checks whether wider bootstrap intervals mark worse predictions. Part of the effect is "
                    "that predictions near 0.5 are both less certain and more often wrong."),
}
CV_NOTES = {
    **NOTES,
    "estimate": ("Repeated cross-validation of the whole modelling procedure on all patients. In every outer "
                 "fold, family selection, tuning, calibration and thresholds were redone on the training part "
                 "only and applied to the held-out patients, so the estimate is not biased by model selection "
                 "(Varma and Simon, 2006). Recommended over a single split at this sample size (Steyerberg, 2018)."),
    "classification": "Accuracy, precision, sensitivity, specificity and F1 use the threshold chosen inside each outer fold.",
}
HOLDOUT_NOTES = {
    **NOTES,
    "holdout": "Unbiased estimate: these patients were never used for training, model selection or thresholds.",
    "dev_oof_optimistic": ("Out-of-fold predictions from nested CV, but the model family and the threshold were "
                           "chosen on these same predictions, so these figures are optimistic."),
}


def fingerprint() -> str:
    h = hashlib.sha256()
    for p in sorted(MODELS_DIR.glob("*.joblib")) + [MODELS_DIR / "metadata.json"]:
        h.update(p.read_bytes())
    return h.hexdigest()


def width_check(width, y, p) -> dict:
    """Do wider bootstrap intervals flag the predictions that turn out worse?"""
    width, y, p = np.asarray(width), np.asarray(y), np.asarray(p)
    err = np.abs(y - p)
    rho = spearmanr(width, err)
    narrow = width <= np.median(width)
    clean = lambda v: None if not np.isfinite(v) else float(v)
    return {"n": int(len(y)), "median_width": float(np.median(width)),
            "spearman_width_vs_error": clean(rho.statistic), "p_value": clean(rho.pvalue),
            "brier_narrow_half": float(np.mean((p[narrow] - y[narrow]) ** 2)),
            "brier_wide_half": float(np.mean((p[~narrow] - y[~narrow]) ** 2)) if (~narrow).any() else None}


def uncertainty_check(bundle, X, y, p) -> dict:
    lo_q, hi_q = cfg()["uncertainty"]["interval"]
    members = np.column_stack([predict_pos(m, X[bundle["features"]]) for m in bundle["bag"]])
    width = np.quantile(members, hi_q, axis=1) - np.quantile(members, lo_q, axis=1)
    return {"n_bag": len(bundle["bag"]), **width_check(width, y, p)}


def subgroup_table(X, y, p, thr, label, target) -> list:
    s = cfg()["subgroups"]
    sex, age = s["sex"], s["age"]
    edges = age["edges"]
    names = [f"<{b}" if a <= 0 else f"{a}+" if i == len(edges) - 2 else f"{a}-{b - 1}"
             for i, (a, b) in enumerate(zip(edges[:-1], edges[1:]))]
    groups = {"sex": X[sex["feature"]].map({float(k): v for k, v in sex["labels"].items()}),
              "age": pd.cut(X[age["feature"]], edges, right=False, labels=names)}
    rows = []
    for kind, g in groups.items():
        for level in g.dropna().unique():
            m = (g == level).values
            yy, pp = y[m], p[m]
            ok = m.sum() >= s["min_n"] and len(set(yy)) == 2
            pm = point_metrics(yy, pp, thr) if ok else {}
            rows.append({"target": target, "set": label, "subgroup": kind, "level": str(level), "n": int(m.sum()),
                         "n_pos": int(yy.sum()), "roc_auc": pm.get("roc_auc"), "brier": pm.get("brier"),
                         "recall": pm.get("recall"), "specificity": pm.get("specificity")})
    return rows


def calibration_plot(curves, title, path) -> None:
    fig, ax = plt.subplots(figsize=(4.5, 4.5))
    ax.plot([0, 1], [0, 1], "k:", label="perfect")
    for lab, yy, pp in curves:
        frac, mean = calibration_curve(yy, pp, n_bins=cfg()["calibration"]["bins"], strategy="quantile")
        ax.plot(mean, frac, marker="o", label=lab)
    ax.set(xlabel="predicted probability", ylabel="observed fraction", title=title)
    ax.legend()
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)


def run_cv() -> None:
    """Score the procedure-CV predictions (full_cv protocol)."""
    meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    oof = pd.read_csv(REPORTS_DIR / "procedure_oof.csv")
    X, Y, _ = get_dev()
    table, subs, summary, uncertainty = [], [], {}, {}
    labels, probs = {}, {}
    for t, m in meta["targets"].items():
        d = oof[oof["target"] == t]
        grid = lambda col: d.pivot(index="repeat", columns="patient_id", values=col).loc[:, X.index].to_numpy()
        P, C, W = grid("p"), grid("pred"), grid("width")
        y = Y[t].to_numpy()
        est, ci = repeated_metrics(y, P, C), repeated_bootstrap_ci(y, P, C)
        for k in KEYS:
            table.append({"target": t, "metric": k, "estimate": est[k], "lo": ci[k][0], "hi": ci[k][1]})
        pbar = P.mean(axis=0)
        labels[t], probs[t] = y, pbar
        subs += subgroup_table(X, y, pbar, m["threshold"], "procedure_cv", t)
        calibration_plot([("cross-validated", y, pbar)], f"{t} calibration", REPORTS_DIR / f"calibration_{t}.png")
        if np.isfinite(W).all():
            uncertainty[t] = {"n_bag": cfg()["validation"]["eval_bag"], **width_check(W.mean(axis=0), y, pbar)}
        summary[t] = {"kind": m["kind"], "family": m["family"], "n": int(len(y)), "n_pos": int(y.sum()),
                      "repeats": int(P.shape[0]), "family_choices_in_outer_folds": m.get("procedure_family_choices"),
                      "sensitivity": est["recall"], "specificity": est["specificity"]}
        log.info("%s cross-validated AUC %.3f [%.3f, %.3f]", t, est["roc_auc"], *ci["roc_auc"])
    yy, pp = pd.DataFrame(labels, index=X.index), pd.DataFrame(probs, index=X.index)
    rows, dca = dca_report(yy, pp, "procedure_cv")
    pd.DataFrame(rows).to_csv(REPORTS_DIR / "decision_curve_validation.csv", index=False)
    plot_dca(rows, "cross-validated", REPORTS_DIR / "decision_curve_validation.png")
    pd.DataFrame(table).to_csv(REPORTS_DIR / "performance_metrics.csv", index=False)
    pd.DataFrame(subs).to_csv(REPORTS_DIR / "subgroups.csv", index=False)
    out = {"protocol": "full_cv", "notes": CV_NOTES, "targets": summary, "consistency": consistency_report(pp),
           "decision_curve": dca, "uncertainty": uncertainty}
    (REPORTS_DIR / "validation_summary.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def run_holdout() -> None:
    """Open the locked holdout and score it (holdout protocol)."""
    meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    Xh, Yh = open_holdout(fingerprint())
    Xd, Yd, _ = get_dev()
    bins = cfg()["calibration"]["bins"]
    table, subs, summary = [], [], {}
    labels, probs, uncertainty = {}, {}, {}
    for t, m in meta["targets"].items():
        b = joblib.load(MODELS_DIR / m["model_file"])
        thr, y = m["threshold"], Yh[t].values
        p = predict_pos(b["model"], Xh[b["features"]])
        labels[t], probs[t] = y, p
        uncertainty[t] = uncertainty_check(b, Xh, y, p)
        hm, hci = point_metrics(y, p, thr), bootstrap_ci(y, p, thr)
        dev = m["dev_oof"]
        for k in KEYS:
            table.append({"target": t, "metric": k,
                          "holdout": hm[k], "holdout_lo": hci[k][0], "holdout_hi": hci[k][1],
                          "dev_oof_optimistic": dev["metrics"][k],
                          "dev_oof_optimistic_lo": dev["ci"][k][0], "dev_oof_optimistic_hi": dev["ci"][k][1]})
        oof = pd.read_csv(REPORTS_DIR / f"oof_{t}.csv").set_index("patient_id").loc[Xd.index]
        subs += subgroup_table(Xd, oof["y"].values, oof["p"].values, thr, "dev_oof", t)
        subs += subgroup_table(Xh, y, p, thr, "holdout", t)
        summary[t] = {"family": m["family"], "threshold": thr, "n": int(len(y)), "n_pos": int(y.sum()),
                      "sensitivity_at_threshold": hm["recall"], "specificity_at_threshold": hm["specificity"]}
        calibration_plot([("dev out-of-fold", oof["y"].values, oof["p"].values), ("holdout", y, p)],
                         f"{t} calibration", REPORTS_DIR / f"calibration_{t}.png")
        log.info("%s holdout AUC %.3f (dev, optimistic %.3f)", t, hm["roc_auc"], dev["metrics"]["roc_auc"])
    yh, ph = pd.DataFrame(labels, index=Xh.index), pd.DataFrame(probs, index=Xh.index)
    rows, dca = dca_report(yh, ph, "holdout")
    pd.DataFrame(rows).to_csv(REPORTS_DIR / "decision_curve_holdout.csv", index=False)
    plot_dca(rows, "holdout", REPORTS_DIR / "decision_curve_holdout.png")
    pd.DataFrame(table).to_csv(REPORTS_DIR / "holdout_metrics.csv", index=False)
    pd.DataFrame(subs).to_csv(REPORTS_DIR / "subgroups.csv", index=False)
    out = {"protocol": "holdout", "notes": HOLDOUT_NOTES, "targets": summary, "consistency": consistency_report(ph),
           "decision_curve": dca, "uncertainty": uncertainty}
    (REPORTS_DIR / "holdout_summary.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


def run() -> None:
    seed_all()
    run_cv() if protocol() == "full_cv" else run_holdout()


if __name__ == "__main__":
    run()
