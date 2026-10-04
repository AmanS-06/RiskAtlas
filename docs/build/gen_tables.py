"""Generate the result tables used in README.md and docs/PROJECT_DOCUMENTATION.md from reports/.

No result number in those two files is typed by hand. Each table sits between markers

    <!-- BEGIN:name -->
    ...
    <!-- END:name -->

and this script rewrites what is between them.

    python docs/build/gen_tables.py --write   # regenerate the blocks in place
    python docs/build/gen_tables.py --check   # exit 1 if a block is stale, or if a number that should
                                              # also appear in docs/ml_results.md does not

Needs only the standard library plus pandas (requirements.txt).
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "reports"
TARGETS = ["CAD", "LAD", "LCX", "RCA"]
FILES = [ROOT / "README.md", ROOT / "docs" / "PROJECT_DOCUMENTATION.md"]


def load():
    perf = pd.read_csv(REPORTS / "performance_metrics.csv")
    perf = {(r.target, r.metric): (r.estimate, r.lo, r.hi) for r in perf.itertuples()}
    ho = pd.read_csv(REPORTS / "archive" / "split_sample_v1" / "holdout_metrics.csv")
    ho = {(r.target, r.metric): (r.holdout, r.holdout_lo, r.holdout_hi) for r in ho.itertuples()}
    return {
        "perf": perf,
        "holdout": ho,
        "audit": json.loads((REPORTS / "data_audit.json").read_text()),
        "meta": json.loads((ROOT / "models" / "metadata.json").read_text()),
        "val": json.loads((REPORTS / "validation_summary.json").read_text()),
        "ext": json.loads((REPORTS / "external_validation.json").read_text()),
        "cf": json.loads((REPORTS / "counterfactuals_summary.json").read_text()),
    }


def ci(v, nd=2):
    e, lo, hi = v
    return f"{e:.{nd}f} [{lo:.{nd}f}, {hi:.{nd}f}]"


def md(header, rows, align=None):
    align = align or ["---"] * len(header)
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(align) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def pct(x):
    return f"{100 * x:.1f}%"


def t_headline_auc(d):
    rows = []
    for t in TARGETS:
        prev = d["audit"]["prevalence"][t]["all"]
        rows.append([t, pct(prev), ci(d["perf"][(t, "roc_auc")]), ci(d["perf"][(t, "brier")]),
                     f"{prev * (1 - prev):.2f}"])
    return md(["Target", "Prevalence", "ROC-AUC [95% CI]", "Brier [95% CI]", "Brier, constant prevalence forecast"],
              rows, ["---", "---:", "---:", "---:", "---:"])


def t_headline_class(d):
    keys = ["accuracy", "precision", "recall", "specificity", "f1"]
    rows = [[t] + [ci(d["perf"][(t, k)]) for k in keys] for t in TARGETS]
    return md(["Target", "Accuracy", "Precision", "Sensitivity", "Specificity", "F1"], rows,
              ["---", "---:", "---:", "---:", "---:", "---:"])


def t_holdout(d):
    rows = [[t, ci(d["perf"][(t, "roc_auc")]), ci(d["holdout"][(t, "roc_auc")])] for t in TARGETS]
    return md(["Target", "Cross-validated, n = 303 (headline)", "First holdout, n = 61 (superseded)"], rows,
              ["---", "---:", "---:"])


def t_bands(d):
    rows = []
    for t in TARGETS:
        m = d["meta"]["targets"][t]
        v = d["val"]["targets"][t]
        rows.append([t, pct(m["prevalence"]), f"{m['threshold']:.3f}", f"{m['rule_out']:.3f}", f"{m['rule_in']:.3f}",
                     pct(v["sensitivity"]), pct(v["specificity"])])
    return md(["Target", "Prevalence", "Threshold", "Rule-out below", "Rule-in from", "CV sensitivity", "CV specificity"],
              rows, ["---", "---:", "---:", "---:", "---:", "---:", "---:"])


def t_external(d):
    e = d["ext"]
    rows = []

    def row(name, blk, n):
        m, c = blk["metrics"], blk["ci"]
        return [name, n, pct(blk["prevalence"]), ci((m["roc_auc"], *c["roc_auc"])), f"{m['brier']:.3f}",
                pct(m["recall"]), pct(m["specificity"])]

    rows.append(row("Internal (out-of-fold)", e["internal"], e["internal"]["n"]))
    rows.append(row("External, all sites", e["external"], e["external"]["n"]))
    for s, lab in [("cleveland", "cleveland"), ("hungary", "hungary"), ("switzerland", "switzerland"),
                   ("va_long_beach", "va_long_beach")]:
        b = e["by_site"][s]
        if "metrics" in b:
            rows.append(row(f"External: {lab}", b, b["n"]))
        else:
            rows.append([f"External: {lab}", b["n"], pct(b["prevalence"]), "not reported (fewer than 10 patients in one class)", "", "", ""])
    return md(["Cohort", "n", "Prevalence", "ROC-AUC [95% CI]", "Brier", "Sensitivity", "Specificity"], rows,
              ["---", "---:", "---:", "---:", "---:", "---:", "---:"])


def t_cf(d):
    rows = []
    for t in TARGETS:
        c = d["cf"]["targets"][t]
        rows.append([t, c["n_high_band"], c["n_evaluated"], pct(c["achieved_share"]), f"{c['mean_changes_when_achieved']:.1f}"])
    return md(["Target", "High-band patients", "Evaluated", "Plausible change found", "Mean changes"], rows,
              ["---", "---:", "---:", "---:", "---:"])


def t_selection(d):
    rows = []
    for t in TARGETS:
        dv = d["meta"]["targets"][t]["dev_cv"]
        cells = [f"{dv[f]['auc']:.3f} ({dv[f]['se']:.3f})" for f in ["lr", "rf", "xgb", "ensemble"]]
        rows.append([t, d["meta"]["targets"][t]["kind"], *cells, d["meta"]["targets"][t]["family"]])
    return md(["Target", "Structure", "lr", "rf", "xgb", "ensemble", "Chosen"], rows,
              ["---", "---", "---:", "---:", "---:", "---:", "---"])


def t_shap(d):
    rows = []
    for t in TARGETS:
        g = pd.read_csv(REPORTS / f"shap_global_{t}.csv").sort_values("rank").head(5)
        drivers = "; ".join(f"{r.label} ({'+' if r.direction_corr > 0 else '-'})" for r in g.itertuples())
        lime = pd.read_csv(REPORTS / f"lime_check_{t}.csv")
        rows.append([t, drivers, f"{lime.overlap_at_k.mean():.2f}"])
    return md(["Target", "Top 5 drivers by mean absolute SHAP (+ raises risk, - lowers)", "SHAP-LIME top-5 overlap"], rows)


TABLES = {"headline-auc": t_headline_auc, "headline-class": t_headline_class, "holdout": t_holdout,
          "bands": t_bands, "external": t_external, "counterfactual": t_cf, "selection": t_selection, "shap": t_shap}
BLOCK = re.compile(r"(<!-- BEGIN:([a-z-]+) -->\n)(.*?)(<!-- END:\2 -->)", re.S)


def cells_in_ml_results(table_md):
    """Numeric cells (e.g. '0.92 [0.88, 0.95]', '81.7%', '0.721') that must also appear in docs/ml_results.md."""
    ml = (ROOT / "docs" / "ml_results.md").read_text()
    missing = []
    for line in table_md.splitlines()[2:]:
        for cell in [c.strip() for c in line.strip("|").split("|")]:
            if re.fullmatch(r"-?\d+(\.\d+)?%?( \[[-\d., ]+\])?( \(\d\.\d+\))?", cell) and cell not in ml:
                missing.append(cell)
    return missing


# cells that are derived here and are not expected in ml_results.md
DERIVED = {"headline-auc": {4}, "bands": set(), "selection": set()}


def main(mode):
    d = load()
    bad = 0
    ml_checked = {"headline-auc", "headline-class", "holdout", "bands", "external", "counterfactual", "selection"}
    for f in FILES:
        text = f.read_text(encoding="utf-8")

        def sub(m):
            nonlocal bad
            name = m.group(2)
            if name not in TABLES:
                raise SystemExit(f"{f.name}: unknown table '{name}'")
            new = TABLES[name](d) + "\n"
            if name in ml_checked:
                tbl = new
                if name == "headline-auc":  # drop the derived last column before cross-checking
                    tbl = "\n".join("|".join(l.split("|")[:-2]) + "|" for l in new.splitlines())
                miss = cells_in_ml_results(tbl)
                if miss:
                    print(f"{f.name} [{name}]: not found in docs/ml_results.md: {miss}")
                    bad += 1
            if mode == "check" and m.group(3) != new:
                print(f"{f.name} [{name}]: stale (run --write)")
                bad += 1
            return m.group(1) + new + m.group(4)

        out = BLOCK.sub(sub, text)
        # hand-typed "0.92 [0.88, 0.95]" style numbers anywhere in the file must also be in ml_results.md
        ml = (ROOT / "docs" / "ml_results.md").read_text()
        for m in re.finditer(r"\d\.\d+ \[\d\.\d+, \d\.\d+\]", BLOCK.sub("", out)):
            if m.group(0) not in ml:
                print(f"{f.name}: '{m.group(0)}' is not in docs/ml_results.md")
                bad += 1
        if mode == "write" and out != text:
            f.write_text(out, encoding="utf-8")
            print("updated", f.relative_to(ROOT))
    if mode == "check":
        print("OK" if not bad else f"{bad} problem(s)")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("--write", "--check"):
        raise SystemExit(__doc__)
    main(sys.argv[1][2:])
