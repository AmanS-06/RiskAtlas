"""External validation on the UCI Heart Disease collection: all four sites (Cleveland, Hungary,
Switzerland, VA Long Beach), using a reduced-feature model trained on development data only.

The ucimlrepo package serves only the 303 Cleveland patients, so the four processed site files
are read straight from the UCI archive instead.
Run from the repo root: python -m pipeline.external
"""
import io
import json
import urllib.request
import zipfile

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression

from pipeline import features
from pipeline.data import get_dev
from pipeline.metrics import bootstrap_ci, operating_points, point_metrics
from pipeline.models import fitted_model, make_search, predict_pos
from pipeline.settings import EXTERNAL_DIR, REPORTS_DIR, cfg, get_logger, seed_all
from pipeline.train import nested_cv

log = get_logger(__name__)
CACHE = EXTERNAL_DIR / "uci_heart_disease_4sites.csv"
COLUMNS = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach",
           "exang", "oldpeak", "slope", "ca", "thal", "num"]
SITES = {"cleveland": "processed.cleveland.data", "hungary": "processed.hungarian.data",
         "switzerland": "processed.switzerland.data", "va_long_beach": "processed.va.data"}
# Features that exist only in the reduced external model, so they are not in features.yaml.
DERIVED_LABELS = {"fbs_high": "Fasting blood sugar > 120 mg/dL"}


def parse_zip(blob: bytes) -> pd.DataFrame:
    frames = []
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for site, name in SITES.items():
            df = pd.read_csv(io.BytesIO(z.read(name)), header=None, names=COLUMNS, na_values="?")
            df["site"] = site
            frames.append(df)
    return pd.concat(frames, ignore_index=True)


def load_uci() -> pd.DataFrame:
    if CACHE.exists():
        return pd.read_csv(CACHE)
    try:
        blob = urllib.request.urlopen(cfg()["external"]["url"], timeout=60).read()
    except Exception as exc:
        raise FileNotFoundError(f"download failed ({exc}); place a cached copy at {CACHE}") from exc
    df = parse_zip(blob)
    EXTERNAL_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(CACHE, index=False)
    return df


def uci_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Map UCI columns onto the reduced canonical features. Missing values stay NaN and are filled
    by the model's imputers (development-set medians). A recorded blood pressure of 0 is missing."""
    num = lambda c: pd.to_numeric(df[c], errors="coerce")
    cp, ecg = num("cp"), num("restecg")
    flag = lambda s, v: (s == v).astype(float).where(s.notna())
    return pd.DataFrame({
        "age": num("age"), "sex": num("sex"), "bp": num("trestbps").where(lambda s: s > 0),
        "fbs_high": num("fbs"),  # UCI fbs is already 1 when fasting blood sugar > 120 mg/dL
        "typical_chest_pain": flag(cp, 1), "atypical": flag(cp, 2), "nonanginal": flag(cp, 3),
        "lvh": flag(ecg, 2)})


def z_frame(X: pd.DataFrame) -> pd.DataFrame:
    out = X.copy()
    out["fbs_high"] = (X["fbs"] > 120).astype(float)
    return out[cfg()["external"]["reduced_features"]]


def calibration_fit(y, p) -> dict:
    """Calibration slope and intercept (1 and 0 are perfect). Slope < 1 means predictions are too extreme."""
    q = np.clip(p, 1e-6, 1 - 1e-6)
    lr = LogisticRegression(C=1e6).fit(np.log(q / (1 - q)).reshape(-1, 1), y)
    return {"slope": float(lr.coef_[0, 0]), "intercept": float(lr.intercept_[0])}


def scored(y, p, thr) -> dict:
    """Metrics with bootstrap CIs, or a note when one class is too small for a stable AUC."""
    y, p = np.asarray(y), np.asarray(p)
    n_pos = int(y.sum())
    out = {"n": int(len(y)), "n_pos": n_pos, "n_neg": int(len(y) - n_pos), "prevalence": float(y.mean())}
    min_n = cfg()["external"]["min_class_n"]
    if min(out["n_pos"], out["n_neg"]) < min_n:
        return {**out, "note": f"fewer than {min_n} patients in one class; metrics not reported"}
    return {**out, "metrics": point_metrics(y, p, thr), "ci": bootstrap_ci(y, p, thr)}


def calibration_plot(y_int, p_int, y_ext, p_ext, path) -> None:
    fig, ax = plt.subplots(figsize=(4.5, 4.5))
    ax.plot([0, 1], [0, 1], "k:", label="perfect")
    for lab, yy, pp in (("internal out-of-fold", y_int, p_int), ("external, 4 sites", y_ext, p_ext)):
        frac, mean = calibration_curve(yy, pp, n_bins=cfg()["calibration"]["bins"], strategy="quantile")
        ax.plot(mean, frac, marker="o", label=lab)
    ax.set(xlabel="predicted probability", ylabel="observed fraction", title="Reduced model calibration")
    ax.legend()
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)


def run() -> dict:
    seed_all()
    ext = cfg()["external"]
    X, Y, _ = get_dev()
    names = ext["reduced_features"]
    reg = features.types([n for n in names if n != "fbs_high"])
    types = {n: reg.get(n, "binary") for n in names}
    Xz, y = z_frame(X), Y[ext["target"]]
    cv = nested_cv(ext["family"], Xz, y, names, types)
    ops = operating_points(y.values, cv["oof"])
    thr = ops["threshold"]
    model = fitted_model(make_search(ext["family"], names, types).fit(Xz, y))

    raw = load_uci()
    keep = pd.to_numeric(raw["num"], errors="coerce").notna()
    raw = raw[keep].reset_index(drop=True)
    Xu, yu = uci_frame(raw), (pd.to_numeric(raw["num"]) > 0).astype(int).values
    p = predict_pos(model, Xu[names])
    site = raw["site"].values

    out = {"target": ext["target"], "family": ext["family"], "features": names, "threshold": thr,
           "internal": {"nested_auc": cv["auc"], "dev_prevalence": float(y.mean()),
                        **scored(y.values, cv["oof"], thr)},
           "external": {**scored(yu, p, thr), "calibration": calibration_fit(yu, p)},
           "by_site": {s: scored(yu[site == s], p[site == s], thr) for s in SITES},
           "missing_rate": {"all": {n: float(Xu[n].isna().mean()) for n in names},
                            **{s: {n: float(Xu.loc[site == s, n].isna().mean()) for n in names} for s in SITES}},
           "note": ("Reduced-feature model: only these features exist in both datasets. Missing values are "
                    "filled with development-set medians. Prevalence and case mix differ between sites, so "
                    "the drop from internal performance is expected and is the finding, not a bug.")}
    calibration_plot(y.values, cv["oof"], yu, p, REPORTS_DIR / "calibration_external.png")
    (REPORTS_DIR / "external_validation.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    ext_auc = out["external"].get("metrics", {}).get("roc_auc", float("nan"))
    log.info("external AUC %.3f on %d patients from %d sites vs internal nested %.3f",
             ext_auc, len(yu), len(SITES), cv["auc"])
    return out


if __name__ == "__main__":
    run()
