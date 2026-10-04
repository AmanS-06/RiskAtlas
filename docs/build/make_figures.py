"""Generate the figures for docs/PROJECT_DOCUMENTATION.md (and README.md) into docs/figures/.

Run from anywhere:  python docs/build/make_figures.py
Needs numpy, pandas, matplotlib (all in requirements.txt). Every number drawn here is read from
reports/, models/ or config/; nothing is typed by hand except box labels and endpoint latencies,
which are quoted from docs/api.md (marked in the code).

Palette: Okabe-Ito (colour-blind safe).
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402
from sklearn.calibration import calibration_curve  # noqa: E402
from sklearn.metrics import roc_curve  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "reports"
FIG = ROOT / "docs" / "figures"
FIG.mkdir(parents=True, exist_ok=True)

# Okabe-Ito
BLUE, ORANGE, GREEN, VERM, SKY, PURPLE, YELLOW, BLACK = (
    "#0072B2", "#E69F00", "#009E73", "#D55E00", "#56B4E9", "#CC79A7", "#F0E442", "#000000")
TARGET_COLOUR = {"CAD": BLACK, "LAD": BLUE, "LCX": ORANGE, "RCA": GREEN}
CM = 1 / 2.54
DPI = 220
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 7, "axes.titlesize": 7.5,
                     "axes.labelsize": 7, "xtick.labelsize": 6.5, "ytick.labelsize": 6.5,
                     "legend.fontsize": 6.3, "axes.spines.top": False, "axes.spines.right": False})
TARGETS = ["CAD", "LAD", "LCX", "RCA"]


# ---------------------------------------------------------------------------------------------
# Figure 1: architecture
# ---------------------------------------------------------------------------------------------
def box(ax, x, y, w, h, title, body, fc, ec, title_size=7, body_size=6):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.25,rounding_size=0.8",
                                fc=fc, ec=ec, lw=1.0))
    ax.text(x + w / 2, y + h - 1.0, title, ha="center", va="top", fontsize=title_size,
            fontweight="bold", color=BLACK)
    ax.text(x + w / 2, y + h - 3.6, body, ha="center", va="top", fontsize=body_size,
            color=BLACK, linespacing=1.35)


def arrow(ax, p, q, text=None, text_xy=None, colour=BLACK, style="-|>", rad=0.0, lw=1.0, ts=5.5):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle=style, mutation_scale=7, lw=lw, color=colour,
                                 connectionstyle=f"arc3,rad={rad}", shrinkA=0, shrinkB=0))
    if text:
        ax.text(*(text_xy or ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 0.8)), text, ha="center",
                va="bottom", fontsize=ts, color=colour)


def figure_architecture():
    fig = plt.figure(figsize=(17.5 * CM, 7.0 * CM))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 40)
    ax.axis("off")
    tint = {"data": "#EAF4FB", "cfg": "#FFF4D6", "ml": "#E3F5EE", "api": "#FBE9DD", "web": "#F5E6EF"}
    # config bar
    box(ax, 18, 32.5, 81.7, 6.5, "config/  (single source of truth)",
        "features.yaml (55 defined, 52 used)   manifest.yaml (targets, mesh names, forbidden labels)   "
        "risk_bands.yaml   ml.yaml", tint["cfg"], ORANGE, body_size=5.8)
    # chain
    y, h = 9.5, 19.5
    box(ax, 0.5, y, 17.5, h, "Public data",
        "UCI 411 Z-Alizadeh Sani\n303 patients: training\nand validation\n\nUCI 45 Heart Disease\n920 patients: external\nvalidation (8 shared\nfeatures)", tint["data"], BLUE)
    box(ax, 22, y, 20, h, "pipeline/",
        "python -m pipeline\naudit, leakage guard\ntrain (nested CV, Platt\ncalibration, bootstrap\nuncertainty), evaluate,\nexplain (SHAP, LIME),\nexternal, analysis,\ncounterfactuals, report", tint["ml"], GREEN)
    box(ax, 46, y, 16, h, "models/ + reports/",
        "CAD, LAD, LCX, RCA\n.joblib + metadata.json\n(cut points per target)\n\nreports/*.csv|json|png\n-> docs/ml_results.md", tint["ml"], GREEN)
    box(ax, 66, y, 14, h, "api/  FastAPI",
        "GET /meta, /health\nPOST /predict/fast\n(median 132 ms)\nPOST /predict\n(median 3.7 s:\nSHAP, uncertainty,\ncounterfactual)", tint["api"], VERM)
    box(ax, 83.5, y, 16.2, h, "web/  React + TS",
        "dashboard built from\n/meta; live sliders\n(debounced fast calls)\n\nHeartViewer (plain\nthree.js class):\nLAD, LCX, RCA nodes", tint["web"], PURPLE)
    for a, b in [(18.6, 21.4), (42.6, 45.4), (62.6, 65.4), (80.6, 82.9)]:
        arrow(ax, (a, y + h / 2), (b, y + h / 2))
    arrow(ax, (82.9, y + h / 2 - 3), (80.6, y + h / 2 - 3), colour=VERM)  # patient inputs back
    ax.text(81.7, y + h / 2 - 5.3, "JSON", fontsize=5, ha="center", color=VERM)
    # config arrows
    arrow(ax, (32, 32.2), (32, y + h + 0.4), colour=ORANGE)
    arrow(ax, (73, 32.2), (73, y + h + 0.4), colour=ORANGE)
    arrow(ax, (91.5, 32.2), (91.5, y + h + 0.4), colour=ORANGE, text="via /meta", text_xy=(95.2, 30.4), ts=5.5)
    # mesh chain
    box(ax, 46, 0.2, 53.7, 7.2, "3D mesh chain (CC BY-SA 4.0)",
        "Z-Anatomy / BodyParts3D -> npm @authorod/svitylo-3d-anatomy-data v1.1.0 -> web/scripts\n"
        "-> web/public/models3d/heart.glb (23,283 triangles), heart_lite.glb (6,691 triangles)", tint["web"], PURPLE, body_size=5.6)
    arrow(ax, (92, 7.6), (92, y - 0.2), colour=PURPLE)
    ax.text(0.5, 3.6, "Black arrows: data flow. Orange: config read by pipeline, api\nand (through /meta) the web app. Latencies: docs/api.md, section 7.", fontsize=5.6, va="center", color="#333333")
    fig.savefig(FIG / "fig_architecture.png", dpi=DPI)
    plt.close(fig)


# ---------------------------------------------------------------------------------------------
# Figure 2: performance panel (ROC, calibration, AUC with intervals)
# ---------------------------------------------------------------------------------------------
def load_metrics():
    m = pd.read_csv(REPORTS / "performance_metrics.csv")
    return {(r.target, r.metric): (r.estimate, r.lo, r.hi) for r in m.itertuples()}


def figure_performance():
    metrics = load_metrics()
    oof = pd.read_csv(REPORTS / "procedure_oof.csv")
    fig = plt.figure(figsize=(17.5 * CM, 6.0 * CM))
    axes = [fig.add_axes([0.055, 0.19, 0.205, 0.60]), fig.add_axes([0.325, 0.19, 0.205, 0.60]),
            fig.add_axes([0.745, 0.19, 0.225, 0.60])]
    # (a) ROC: mean over CV repeats on a common FPR grid
    ax = axes[0]
    grid = np.linspace(0, 1, 101)
    for t in TARGETS:
        d = oof[oof.target == t]
        tprs = []
        for _, g in d.groupby("repeat"):
            f, tp, _ = roc_curve(g.y, g.p)
            tprs.append(np.interp(grid, f, tp))
        auc = metrics[(t, "roc_auc")][0]
        ax.plot(grid, np.mean(tprs, axis=0), color=TARGET_COLOUR[t], lw=1.4, label=f"{t}  AUC {auc:.2f}")
    ax.plot([0, 1], [0, 1], ":", color="#777777", lw=0.9)
    ax.set_xlabel("1 - specificity")
    ax.set_ylabel("sensitivity")
    ax.set_title("(a) ROC, cross-validated", loc="left")
    ax.legend(loc="lower right", frameon=True, framealpha=0.92, edgecolor="none", handlelength=0.9,
              labelspacing=0.25, borderpad=0.25, borderaxespad=0.1)
    ax.set_box_aspect(1)
    # (b) calibration: five quantile bins, pooled over the two repeats
    ax = axes[1]
    for t in TARGETS:
        d = oof[oof.target == t]
        frac, mean_p = calibration_curve(d.y, d.p, n_bins=5, strategy="quantile")
        ax.plot(mean_p, frac, "o-", color=TARGET_COLOUR[t], lw=1.2, ms=3, label=t)
    ax.plot([0, 1], [0, 1], ":", color="#777777", lw=0.9)
    ax.set_xlabel("predicted probability")
    ax.set_ylabel("observed fraction")
    ax.set_title("(b) Calibration, out-of-fold", loc="left")
    ax.legend(loc="upper left", frameon=False, handlelength=1.2)
    ax.set_box_aspect(1)
    # (c) AUC with 95% intervals: CV headline vs archived 61-patient holdout, then external validation
    ax = axes[2]
    ho = pd.read_csv(REPORTS / "archive" / "split_sample_v1" / "holdout_metrics.csv")
    ho = ho[ho.metric == "roc_auc"].set_index("target")
    ext = json.loads((REPORTS / "external_validation.json").read_text())
    rows = []  # (label, est, lo, hi, colour, marker)
    for t in TARGETS:
        e, lo, hi = metrics[(t, "roc_auc")]
        rows.append((f"{t} cross-validated", e, lo, hi, TARGET_COLOUR[t], "o"))
        r = ho.loc[t]
        rows.append((f"{t} first holdout", r.holdout, r.holdout_lo, r.holdout_hi, TARGET_COLOUR[t], "s"))
    rows.append(None)
    i = ext["internal"]
    rows.append(("reduced CAD, internal", i["metrics"]["roc_auc"], *i["ci"]["roc_auc"], BLACK, "o"))
    x = ext["external"]
    rows.append(("UCI external, all sites", x["metrics"]["roc_auc"], *x["ci"]["roc_auc"], PURPLE, "D"))
    for s, lab in [("cleveland", "Cleveland"), ("hungary", "Hungary"), ("va_long_beach", "VA Long Beach")]:
        v = ext["by_site"][s]
        rows.append((f"   {lab}", v["metrics"]["roc_auc"], *v["ci"]["roc_auc"], PURPLE, "D"))
    ypos, labels = [], []
    yy = 0
    for r in rows:
        if r is None:
            yy += 0.7
            continue
        lab, e, lo, hi, c, mk = r
        ax.plot([lo, hi], [yy, yy], color=c, lw=1.3)
        ax.plot([e], [yy], mk, color=c, ms=3.4, mfc=c if mk != "s" else "white")
        ypos.append(yy)
        labels.append(lab)
        yy += 1
    ax.set_yticks(ypos)
    ax.set_yticklabels(labels, fontsize=5.6)
    ax.invert_yaxis()
    ax.axvline(0.5, color="#777777", lw=0.8, ls=":")
    ax.set_xlim(0.45, 1.0)
    ax.set_xlabel("ROC-AUC")
    ax.set_title("(c) ROC-AUC with 95% intervals", loc="left")
    fig.savefig(FIG / "fig_performance.png", dpi=DPI)
    plt.close(fig)


# ---------------------------------------------------------------------------------------------
# Figure 3: global SHAP drivers
# ---------------------------------------------------------------------------------------------
def figure_shap(top=7):
    fig, axes = plt.subplots(2, 2, figsize=(17.5 * CM, 6.4 * CM))
    for ax, t in zip(axes.flat, TARGETS):
        d = pd.read_csv(REPORTS / f"shap_global_{t}.csv").sort_values("rank").head(top)[::-1]
        colours = [VERM if c > 0 else BLUE for c in d.direction_corr]
        ax.barh(d.label, d.mean_abs_shap, color=colours, height=0.65)
        ax.set_title(t, loc="left", fontweight="bold", pad=2)
        ax.tick_params(axis="y", labelsize=6)
        ax.tick_params(axis="x", labelsize=6)
    for ax in axes[1]:
        ax.set_xlabel("mean |SHAP|, probability scale", fontsize=6.3)
    fig.tight_layout(h_pad=0.5, w_pad=1.0)
    fig.savefig(FIG / "fig_shap.png", dpi=DPI)
    plt.close(fig)


# ---------------------------------------------------------------------------------------------
# Figure 4: the app and the 3D viewer (composed from screenshots already in the repo / docs/figures)
# ---------------------------------------------------------------------------------------------
def figure_app():
    from matplotlib import image as mpimg
    fig = plt.figure(figsize=(17.5 * CM, 7.8 * CM))
    gs = fig.add_gridspec(2, 3, height_ratios=[5.0, 2.3], width_ratios=[1, 1, 1], wspace=0.02, hspace=0.12)
    # row 1: the app (1920x1080, real API) on the left two thirds, a harness view on the right third
    axa = fig.add_subplot(gs[0, 0:2])
    axa.imshow(mpimg.imread(FIG / "app_dashboard_high.png")[:, 80:1840])
    axa.set_anchor("NW")
    axa.axis("off")
    axa.set_title("(a) Dashboard against the real API, 1920x1080, rendered on software WebGL (lite model)", fontsize=6.2, loc="left", pad=2)
    axb = fig.add_subplot(gs[0, 2])
    axb.imshow(mpimg.imread(FIG / "viewer_selected_LCX.png"))
    axb.set_anchor("N")
    axb.axis("off")
    axb.set_title("(b) Harness, standard model, LCX selected", fontsize=5.8, loc="left", pad=2)
    for k, (f, cap) in enumerate([("app_viewer_low.png", "(c) low-risk preset"), ("app_viewer_moderate.png", "(d) moderate-risk preset"),
                                  ("app_viewer_high.png", "(e) high-risk preset")]):
        ax = fig.add_subplot(gs[1, k])
        ax.imshow(mpimg.imread(FIG / f))
        ax.axis("off")
        ax.set_title(cap + ", real API, in-app viewer", fontsize=5.8, loc="left", pad=2)
    fig.subplots_adjust(left=0.004, right=0.996, top=0.955, bottom=0.004)
    fig.savefig(FIG / "fig_app.png", dpi=DPI)
    plt.close(fig)


def figure_tabs():
    """Physiology and what-if tabs of the dashboard (crops of two real-API screenshots)."""
    from matplotlib import image as mpimg
    crops = [(mpimg.imread(FIG / "app_dashboard_moderate_physiology.png")[90:545, 930:1825],
              "(a) Physiology tab: value, range, status, share of effect"),
             (mpimg.imread(FIG / "app_dashboard_whatif.png")[90:545, 930:1825],
              "(b) What-if tab: counterfactual changes and the mandatory note")]
    fig = plt.figure(figsize=(17.5 * CM, 4.7 * CM))
    for k, (img, cap) in enumerate(crops):
        ax = fig.add_axes([0.006 + k * 0.5, 0.0, 0.488, 0.92])
        ax.imshow(img)
        ax.axis("off")
        fig.text(0.006 + k * 0.5, 0.995, cap, fontsize=6.4, va="top")
    fig.savefig(FIG / "fig_tabs.png", dpi=DPI)
    plt.close(fig)


if __name__ == "__main__":
    which = sys.argv[1:] or ["architecture", "performance", "shap", "app", "tabs"]
    for w in which:
        {"architecture": figure_architecture, "performance": figure_performance,
         "shap": figure_shap, "app": figure_app, "tabs": figure_tabs}[w]()
        print("wrote", w)
