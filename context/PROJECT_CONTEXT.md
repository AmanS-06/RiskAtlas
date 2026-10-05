# RiskAtlas: project context

_Last updated: 2026-10-05_

## What it is
Track A entry (Multimodal AI Hackathon 2026): interactive 3D coronary risk map plus explainable dashboard. Predicts
overall CAD and LAD/LCX/RCA stenosis from 52 clinical features (Z-Alizadeh Sani, 303 patients), draws probabilities on a
3D heart, explains them with SHAP, shows physiology against reference ranges and counterfactual what-ifs.

## State of the repo
- `main` at the merge of PR #1 (`229f82c`, 2026-10-05): ML pipeline, FastAPI (`api/`), React + TS dashboard (`web/`),
  three.js `HeartViewer`, docs and submission pack. Not deployed yet.
- Stack: Vite 8, React 19, TypeScript, three 0.186, plain CSS tokens (`web/src/shared/theme.css`). FastAPI backend.
- Tests at merge: 189 Python, 193 web unit/component, 38 browser (Playwright) against the real backend, axe scan clean.
- ML (headline, repeated nested CV): CAD AUC 0.92, LAD 0.84, LCX 0.72, RCA 0.73.
- Not built yet: heartbeat, 17-segment bullseye, report reader (`cv/`), natural-language layer (`slm/`).

## Current work
UI remake, see `UI_REMAKE.md`. Old UI preserved in `web-legacy/` (unchanged, 193 unit tests pass) and tag `legacy-ui-v1`. New UI is built in `web/`.

## Log
- 2026-10-05: repo reviewed, direction agreed (Hybrid), `context/` created. No code changes yet.
- 2026-10-05: ML reviewed, see `ML_NOTES.md`. Workflow fixed: direct to `main`, commits under Harsh only.
- 2026-10-05: old UI preserved (`web-legacy/`, tag `legacy-ui-v1`). Next: tokens and shell, then viewer regions.
