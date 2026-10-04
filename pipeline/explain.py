"""SHAP attributions in probability space (permutation explainer on the full calibrated model) and a LIME cross-check.

Explainers are built with explainer_for() and passed in by the caller, who owns the cache.
They are never stored inside the model bundle, so a bundle can always be re-saved.
"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from lime.lime_tabular import LimeTabularExplainer

from pipeline import features
from pipeline.models import predict_pos
from pipeline.settings import REPORTS_DIR, cfg, seed


def _fn(model, names):
    return lambda a: predict_pos(model, pd.DataFrame(np.asarray(a, dtype=float), columns=names))


def explainer_for(bundle):
    names, bg = bundle["features"], bundle["background"]
    masker = shap.maskers.Independent(bg[names].values, max_samples=len(bg))
    return shap.Explainer(_fn(bundle["model"], names), masker,
                          algorithm="permutation", seed=seed(), feature_names=names)


def shap_values(bundle, X: pd.DataFrame, ex=None):
    names = bundle["features"]
    evals = 2 * len(names) * cfg()["explain"]["shap_perms"] + 1
    return (ex or explainer_for(bundle))(X[names].values, max_evals=evals)


def shap_row(bundle, row: pd.DataFrame, ex=None) -> dict:
    e = shap_values(bundle, row.head(1), ex)
    return {"base": float(e.base_values[0]),
            "contributions": {n: float(v) for n, v in zip(bundle["features"], e.values[0])}}


def global_table(bundle, X_dev: pd.DataFrame, ex=None) -> pd.DataFrame:
    names, t = bundle["features"], bundle["target"]
    rows = X_dev[names].sample(n=min(cfg()["explain"]["global_rows"], len(X_dev)), random_state=seed())
    e = shap_values(bundle, rows, ex)
    # A correlation is undefined when either side is constant (e.g. a feature the model ignores).
    direction = [np.corrcoef(rows[n], e.values[:, i])[0, 1]
                 if rows[n].nunique() > 1 and np.ptp(e.values[:, i]) > 0 else np.nan
                 for i, n in enumerate(names)]
    labels = [features.by_name()[n]["label"] for n in names]
    df = pd.DataFrame({"feature": names, "label": labels, "mean_abs_shap": np.abs(e.values).mean(axis=0),
                       "direction_corr": direction}).sort_values("mean_abs_shap", ascending=False)
    df["rank"] = np.arange(1, len(df) + 1)
    df.to_csv(REPORTS_DIR / f"shap_global_{t}.csv", index=False)
    return df


def waterfall_pngs(bundle, X_dev: pd.DataFrame, ex=None) -> None:
    t, names = bundle["target"], bundle["features"]
    rows = X_dev[names].sample(n=cfg()["explain"]["shap_cases"], random_state=seed())
    e = shap_values(bundle, rows, ex)
    for i in range(len(rows)):
        shap.plots.waterfall(e[i], show=False)
        plt.gcf().savefig(REPORTS_DIR / f"shap_waterfall_{t}_{i}.png", bbox_inches="tight", dpi=130)
        plt.close("all")


def lime_check(bundle, X_dev: pd.DataFrame, ex=None) -> float:
    """Mean top-k overlap between SHAP and LIME on a few development patients."""
    c, names, t = cfg()["explain"], bundle["features"], bundle["target"]
    k, types = c["top_k"], features.types(names)
    cats = [i for i, n in enumerate(names) if types[n] != "numeric"]
    fn = lambda a: bundle["model"].predict_proba(pd.DataFrame(np.asarray(a, dtype=float), columns=names))
    lime = LimeTabularExplainer(X_dev[names].values, feature_names=names, categorical_features=cats,
                                class_names=["neg", "pos"], mode="classification", random_state=seed())
    rows = X_dev[names].sample(n=c["lime_cases"], random_state=seed())
    sv = shap_values(bundle, rows, ex).values
    out = []
    for i in range(len(rows)):
        exp = lime.explain_instance(rows.iloc[i].values, fn, labels=(1,), num_features=k,
                                    num_samples=c["lime_samples"])
        l_idx = {j for j, _ in exp.as_map()[1]}
        s_idx = set(np.argsort(-np.abs(sv[i]))[:k])
        out.append({"patient_id": int(rows.index[i]), "overlap_at_k": len(l_idx & s_idx) / k,
                    "shap_top": ",".join(names[j] for j in sorted(s_idx)),
                    "lime_top": ",".join(names[j] for j in sorted(l_idx))})
    df = pd.DataFrame(out)
    df.to_csv(REPORTS_DIR / f"lime_check_{t}.csv", index=False)
    return float(df["overlap_at_k"].mean())


def run(targets=None) -> None:
    import json
    import joblib
    from pipeline.data import get_dev
    from pipeline.settings import MODELS_DIR, get_logger
    log = get_logger(__name__)
    meta = json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    X, _, _ = get_dev()
    for t in targets or meta["targets"]:
        try:
            bundle = joblib.load(MODELS_DIR / meta["targets"][t]["model_file"])
            ex = explainer_for(bundle)
            global_table(bundle, X, ex)
            waterfall_pngs(bundle, X, ex)
            log.info("%s: SHAP vs LIME top-%d overlap %.2f", t, cfg()["explain"]["top_k"], lime_check(bundle, X, ex))
        except Exception:
            log.exception("explanations failed for %s", t)


if __name__ == "__main__":
    import sys
    run(sys.argv[1:] or None)
