"""SHAP attributions in probability space (permutation explainer on the full calibrated model) and a LIME cross-check.

Explainers are built with explainer_for() and passed in by the caller, who owns the cache.
They are never stored inside the model bundle, so a bundle can always be re-saved.

Reproducibility contract: the explanation of a row is a pure function of (model bundle, row values, seed,
max_evals). It does not depend on call history, on other threads, on numpy's global RNG, or on whether the
explainer was freshly built or reused. See docs/shap_reproducibility.md for the root cause this fixes.
"""
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from lime.lime_tabular import LimeTabularExplainer
from shap.utils import MaskedModel

from pipeline import features
from pipeline.models import predict_pos
from pipeline.settings import REPORTS_DIR, cfg, seed


def _fn(model, names):
    return lambda a: predict_pos(model, pd.DataFrame(np.asarray(a, dtype=float), columns=names))


class PermutationExplainer:
    """shap's permutation algorithm (shap 0.51, Independent masker, antithetic permutations) without its hidden state.

    shap.Explainer(..., algorithm="permutation", seed=s) only calls np.random.seed(s) once, in its constructor, and
    then draws every permutation from numpy's global RNG (np.random.shuffle), so an explanation depends on how many
    draws came before it, and two threads interleave their draws. Its masker also owns mutable buffers. This class
    runs the same loop on shap's own MaskedModel and Independent masker, but each row gets a fresh
    np.random.RandomState(seed) and a fresh masker. Nothing is mutated between calls, so one instance can be shared
    by any number of threads, with no lock and no reseeding. For one row it is bit-identical to shap's explainer
    right after np.random.seed(seed) (tests/test_explain_determinism.py checks this, which also guards against a
    shap upgrade changing the algorithm).

    By default every row restarts the same random stream, so a row's values do not depend on its position in X or
    on the other rows: ex(X)[i] equals ex(X[i:i+1])[0]. That is what a per-patient explanation needs (the same
    patient gets the same bars in the API, the waterfall plots and the LIME check). It is the wrong choice when
    averaging over many rows, because every row then reuses the same few permutations and their sampling error no
    longer averages out (about twice the error on a mean |SHAP| over 50 patients). global_table therefore passes
    independent_rows=True: row i gets its own stream, still a pure function of (seed, i).
    """

    def __init__(self, model_fn, background, feature_names, rng_seed):
        self.feature_names = list(feature_names)
        self.seed = int(rng_seed)
        self._model = shap.models.Model(model_fn)
        self._background = np.array(background, dtype=float)  # private copy; only ever read

    def __call__(self, X, max_evals=500, independent_rows=False) -> shap.Explanation:
        started = time.time()
        X = np.asarray(X, dtype=float)
        rows = [self.explain_row(x, max_evals, self._stream(i) if independent_rows else None) for i, x in enumerate(X)]
        return shap.Explanation(np.array([v for v, _ in rows]), np.array([b for _, b in rows]), X,
                                feature_names=self.feature_names, compute_time=time.time() - started)

    def _stream(self, i):
        """Random stream of row i when rows are not meant to share permutations: independent by construction."""
        return np.random.RandomState(np.random.MT19937(np.random.SeedSequence([self.seed, i])))

    def explain_row(self, x, max_evals, rng=None):
        """(values, base value) for one row. rng defaults to a fresh RandomState(seed); __call__ passes a per-row stream
        when independent_rows is set."""
        rng = np.random.RandomState(self.seed) if rng is None else rng
        masker = shap.maskers.Independent(self._background, max_samples=len(self._background))
        fm = MaskedModel(self._model, masker, shap.links.identity, True, x)
        if max_evals == "auto":
            max_evals = 10 * 2 * len(fm)
        inds = fm.varying_inputs()  # features that differ from the background; the others get exactly 0
        n_masks = 2 * len(inds) + 1
        npermutations = max_evals // n_masks
        if len(inds) == 0:
            return np.zeros(len(fm)), fm(np.zeros(1, dtype=int), zero_index=0, batch_size=1)[0]
        if npermutations == 0:
            raise ValueError(f"max_evals={max_evals} is too low for the permutation explainer, "
                             f"it must be at least 2 * num_features + 1 = {n_masks}")
        masks = np.zeros(n_masks, dtype=int)
        masks[0] = MaskedModel.delta_mask_noop_value
        values = np.zeros(len(fm))
        for _ in range(npermutations):
            rng.shuffle(inds)
            masks[1:1 + len(inds)] = inds  # forward pass, then the same order again for the backward pass
            masks[1 + len(inds):] = inds
            outputs = fm(masks, zero_index=0, batch_size=10)
            for i, ind in enumerate(inds):
                values[ind] += outputs[i + 1] - outputs[i]  # forward
            for i, ind in enumerate(inds):
                values[ind] += outputs[len(inds) + i] - outputs[len(inds) + i + 1]  # backward
        return values / (2 * npermutations), outputs[0]


def explainer_for(bundle, rng_seed=None):
    """Thread-safe, stateless explainer for a bundle. Same call convention as a shap explainer: ex(X, max_evals=n)."""
    names = bundle["features"]
    return PermutationExplainer(_fn(bundle["model"], names), bundle["background"][names].values, names,
                                seed() if rng_seed is None else rng_seed)


def shap_values(bundle, X: pd.DataFrame, ex=None, independent_rows=False):
    """SHAP values for the rows of X. Each row is a pure function of (bundle, row, seed) unless independent_rows."""
    names = bundle["features"]
    evals = 2 * len(names) * cfg()["explain"]["shap_perms"] + 1
    kwargs = {"independent_rows": True} if independent_rows else {}
    return (explainer_for(bundle) if ex is None else ex)(X[names].values, max_evals=evals, **kwargs)


def shap_row(bundle, row: pd.DataFrame, ex=None) -> dict:
    e = shap_values(bundle, row.head(1), ex)
    return {"base": float(e.base_values[0]),
            "contributions": {n: float(v) for n, v in zip(bundle["features"], e.values[0])}}


def global_table(bundle, X_dev: pd.DataFrame, ex=None) -> pd.DataFrame:
    names, t = bundle["features"], bundle["target"]
    rows = X_dev[names].sample(n=min(cfg()["explain"]["global_rows"], len(X_dev)), random_state=seed())
    e = shap_values(bundle, rows, ex, independent_rows=True)  # an average over rows: do not reuse one permutation set
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
