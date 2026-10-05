"""Run illustrative demo patients through a running RiskAtlas API and print what the UI will show.

Usage (backend already running, see docs/submission/DEMO_DATA.md):

    python scripts/submission/demo_patients.py                       # the three app presets, API on :8031
    python scripts/submission/demo_patients.py --api http://127.0.0.1:8000
    python scripts/submission/demo_patients.py --extra scripts/submission/extra_patients.json
    python scripts/submission/demo_patients.py --json out.json       # also save the full responses

Only the standard library is used. The patients are illustrative, not real people. The script never reads the dataset:
it posts feature values to /predict, exactly like the web app, so what it prints is what the dashboard will show.
Re-run it after any model retrain: the numbers in docs/submission/DEMO_DATA.md and DEMO_SCRIPT.md must then be updated.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PRESETS = REPO / "web" / "src" / "dashboard" / "presets.json"
TARGETS = ("CAD", "LAD", "LCX", "RCA")


def post(api: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(
        api + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:  # surface the API's error body, it says what is wrong
        sys.exit(f"{path} -> HTTP {e.code}: {e.read().decode()[:500]}")
    except urllib.error.URLError as e:
        sys.exit(f"cannot reach {api}: {e.reason}. Is the backend running?")


def get(api: str, path: str) -> dict:
    with urllib.request.urlopen(api + path, timeout=30) as r:
        return json.load(r)


def summarise(name: str, res: dict) -> None:
    print(f"\n{name}  (mock={res.get('mock')}, missing inputs={len(res['input']['missing'])})")
    for t in TARGETS:
        r = res["targets"][t]
        u = r.get("uncertainty")
        unc = f"  interval {u['low']:.0%} to {u['high']:.0%}" if u else ""
        print(f"  {t}: {r['probability']:.1%}  {r['band']:<8} (cuts {r['rule_out']:.0%} / {r['rule_in']:.0%}){unc}")
        cf = r.get("counterfactual")
        if cf and cf.get("needed") and cf.get("changes"):
            ch = ", ".join(f"{c['feature']} {c['from']:g} -> {c['to']:g}" for c in cf["changes"])
            print(f"      what-if: {cf['start']:.1%} -> {cf['end']:.1%} achieved={cf['achieved']}  [{ch}]")
        elif cf and cf.get("needed"):
            print("      what-if: needed, but no plausible change found")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://127.0.0.1:8031")
    ap.add_argument("--extra", help="JSON list of {id,label,values} to run in addition to the app presets")
    ap.add_argument("--json", help="write full responses to this file")
    ap.add_argument("--fast", action="store_true", help="use /predict/fast (probabilities and bands only)")
    a = ap.parse_args()

    health = get(a.api, "/health")
    if health.get("mock"):
        sys.exit("The API is in mock mode (API_MOCK=1): its numbers are fixed and meaningless. Start it without API_MOCK.")
    if not health.get("models_loaded"):
        sys.exit(f"models not loaded: {health.get('error')}")
    print("API:", a.api, "| model created:", health["model"]["created"], "| git:", health["model"]["git_sha"][:10])

    patients = json.loads(PRESETS.read_text(encoding="utf-8"))
    if a.extra:
        patients += json.loads(Path(a.extra).read_text(encoding="utf-8"))

    out = {}
    for p in patients:
        res = post(a.api, "/predict/fast" if a.fast else "/predict", p["values"])
        out[p["id"]] = {"label": p.get("label"), "summary": p.get("summary"), "values": p["values"], "response": res}
        summarise(f"{p['id']}: {p.get('summary', '')}", res)

    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1), encoding="utf-8")
        print("\nwrote", a.json)


if __name__ == "__main__":
    main()
