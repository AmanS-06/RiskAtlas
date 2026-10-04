"""Development-set analyses on the trained models, plus artefacts for the API team.

- Cross-target consistency and decision curves from out-of-fold predictions.
- reports/example_prediction.json: a real predict_all() payload for an illustrative high-risk
  profile, usable as the backend's mock response.
- Latency of the full and fast prediction paths.

The same consistency and decision-curve functions are reused on the holdout by pipeline.evaluate.
Run from the repo root: python -m pipeline.analysis
"""
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from pipeline.metrics import cad_consistency, decision_curve, useful_range
from pipeline.settings import REPORTS_DIR, cfg, get_logger, manifest, split_targets

log = get_logger(__name__)
OOF_NOTE = ("Computed on out-of-fold development predictions. The model family was chosen on these same "
            "predictions, so they are mildly optimistic; pipeline.evaluate repeats this on the holdout.")


def thresholds() -> np.ndarray:
    d = cfg()["analysis"]["dca"]
    return np.round(np.arange(d["start"], d["stop"] + 1e-9, d["step"]), 4)


def load_oof(targets) -> tuple:
    frames = {t: pd.read_csv(REPORTS_DIR / f"oof_{t}.csv").set_index("patient_id") for t in targets}
    return (pd.DataFrame({t: f["y"] for t, f in frames.items()}),
            pd.DataFrame({t: f["p"] for t, f in frames.items()}))


def consistency_report(p: pd.DataFrame) -> dict:
    overall, vessels = split_targets()
    tol = cfg()["analysis"]["consistency_tolerance"]
    return {t: cad_consistency(p[t], [p[v] for v in vessels], tol) for t in overall}


def dca_report(y: pd.DataFrame, p: pd.DataFrame, label: str) -> tuple:
    grid = thresholds()
    rows, summary = [], {}
    for t in y.columns:
        curve = decision_curve(y[t], p[t], grid)
        rows += [{"target": t, "set": label, **r} for r in curve]
        summary[t] = {"useful_threshold_range": useful_range(curve), "prevalence": float(y[t].mean())}
    return rows, summary


def plot_dca(rows: list, title: str, path) -> None:
    df = pd.DataFrame(rows)
    targets = list(dict.fromkeys(df["target"]))
    fig, axes = plt.subplots(1, len(targets), figsize=(4 * len(targets), 3.6), sharey=True)
    for ax, t in zip(np.atleast_1d(axes), targets):
        d = df[df["target"] == t]
        ax.plot(d["threshold"], d["model"], label="model")
        ax.plot(d["threshold"], d["treat_all"], "--", label="treat all")
        ax.axhline(0, color="k", lw=0.8, label="treat none")
        ax.set(title=t, xlabel="threshold probability", ylim=(-0.05, max(0.05, d["model"].max() * 1.15)))
    np.atleast_1d(axes)[0].set_ylabel("net benefit")
    np.atleast_1d(axes)[-1].legend(fontsize=8)
    fig.suptitle(f"Decision curves ({title})")
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)


def example_profile(meta: dict) -> dict:
    row = {n: s["median"] for n, s in meta["feature_stats"].items()}
    row.update({k: v for k, v in cfg()["analysis"]["example_overrides"].items() if k in row})
    return row


def run() -> dict:
    from pipeline.predict import RiskAtlas, benchmark
    targets = list(manifest()["targets"])
    y, p = load_oof(targets)
    rows, dca = dca_report(y, p, "dev_oof")
    pd.DataFrame(rows).to_csv(REPORTS_DIR / "decision_curve_dev.csv", index=False)
    plot_dca(rows, "development, out-of-fold", REPORTS_DIR / "decision_curve_dev.png")

    ra = RiskAtlas()
    profile = example_profile(ra.meta)
    example = {"input": profile, "output": ra.predict_all(profile)}
    (REPORTS_DIR / "example_prediction.json").write_text(json.dumps(example, indent=1, allow_nan=False),
                                                       encoding="utf-8")
    out = {"note": OOF_NOTE, "consistency": consistency_report(p), "decision_curve": dca,
           "latency_ms_median": benchmark()}
    (REPORTS_DIR / "dev_analysis.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    log.info("analysis: consistency %s | latency %s",
             {t: round(c["share_below_top_vessel"], 3) for t, c in out["consistency"].items()},
             out["latency_ms_median"])
    return out


if __name__ == "__main__":
    run()
