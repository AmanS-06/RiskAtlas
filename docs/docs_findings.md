# Documentation findings

Inconsistencies and gaps found while writing `README.md`, `docs/PROJECT_DOCUMENTATION.md` and the PDF
(2026-10-04, base commit `b795a64`). The documentation author could only edit `README.md`,
`ASSETS_AND_LICENSES.md`, `docs/PROJECT_DOCUMENTATION.*`, `docs/figures/`, `docs/build/` and
`docs/CONTRIBUTORS.md`, so everything in section B is left for the lead. Each item has its evidence.

## A. Fixed in files the documentation author owns

| # | Was | Now |
|---|---|---|
| A1 | `README.md` said "Backend and frontend setup will be added here" and had TBD team rows | Full setup, test and troubleshooting sections; team table with real names and TBD roles |
| A2 | `README.md` stack row said "React Three Fiber" | Says the viewer is a framework-free three.js class wrapped by one React component (matches `web/src/viewer/HeartViewer.ts`, `docs/viewer_findings.md` item 2) |
| A3 | `README.md` said "Node 20" | `^20.19.0` or `>=22.12.0`, because Vite 8 requires it (`web/package.json` engines; `docs/viewer_findings.md` item 6). Tested on Node 22.22.0 only |
| A4 | `README.md` had no CC BY-SA attribution | Exact attribution text added (`docs/viewer_findings.md` item 8); dataset citations added |
| A5 | README disclaimer was the old API wording | Now the UI wording (`web/src/shared/constants.ts` `DISCLAIMER`) |
| A6 | `README.md` said tests that need data or models "skip on a fresh clone" | Models are committed, so only 3 tests that need the dataset skip (97 pass, 3 skip, verified) |
| A7 | `ASSETS_AND_LICENSES.md` Fonts row was TBD; dataset row said "59 features" | Fonts row filled (system font stack, plus the two fonts embedded in the PDF); "59 columns (55 candidate inputs and 4 outcome columns)", checked against the xlsx (303 x 59) |
| A8 | `README.md` layout listed `common/`, `cv/`, `slm/` as if populated | Marked as empty placeholders |

## B. For the lead (files outside the documentation author's scope)

1. **Disclaimer wording differs between the API and the UI.** `api/schemas.py` `DISCLAIMER` is "RiskAtlas is for
   decision support and educational purposes only. It is not a substitute for formal diagnostic imaging or
   clinical judgement, and it must not be used to make patient care decisions." The UI
   (`web/src/shared/constants.ts`) says "RiskAtlas is a research prototype for decision support and educational
   purposes only. It is not a medical device, does not provide a diagnosis, and is not a substitute for formal
   diagnostic imaging or clinical judgement." `docs/api.md` quotes the API wording. Suggest changing the API
   constant (and its tests) to the UI wording, and `docs/api.md` with it. Also in `docs/web_findings.md` item 2.
2. **`docs/TEAM_STANDARD.md` is stale in three places.** It says the band names are `low/amber/high` (config ids
   are `low`, `moderate`, `high`), "Node 20" (needs 20.19+), and `risk_bands.yaml # probability -> band` (cut
   points are per target, in `models/metadata.json`).
3. **`docs/ml_interface.md` section 6** still says the `anchor` field is "Currently empty for all features";
   `config/features.yaml` has eight anchors (`docs/viewer_findings.md` item 4).
4. **`.env.example` uses names the code does not read.** `API_HOST`, `API_PORT` and `VITE_API_BASE_URL` appear
   nowhere in `api/`, `pipeline/` or `web/` (grep). The code reads `VITE_API_BASE`, `VITE_API_MOCK`,
   `VITE_API_PROXY`, `API_CORS_ORIGINS`, `API_CACHE_FAST`, `API_CACHE_FULL`, `API_WARMUP`. The README
   documents the real names. (Also `docs/backend_findings.md` item 8.)
5. **`npm run lint` fails and `npm run format:check` reports 21 files** on the committed tree:
   `viewer-demo/e2e/viewer.e2e.test.ts:487:130 Irregular whitespace not allowed`; Prettier flags the viewer
   sources, `web/scripts/*.mjs`, the licence files and `viewer-demo/`. `npm run typecheck`, `npm test` and
   `npm run e2e` pass. The README does not claim lint passes.
6. **SHAP callouts are not pinned to the 3D anatomy in the app.** `TEAM_STANDARD.md` lists "SHAP drivers pinned
   to anatomy"; the viewer implements `setAnchors`/`onAnchors` and `features.yaml` has eight anchors, but
   nothing outside `web/src/viewer/` calls them (grep). The documentation says the viewer can do it and the
   dashboard does not use it yet.
7. **Heartbeat animation and the 17-segment bullseye are not built** (`docs/viewer_findings.md` item 7); the
   documentation says so. The report reader (`cv/`) and the natural-language layer (`slm/`) are empty folders.
8. **No licence file for the application source code.** `ASSETS_AND_LICENSES.md` notes the `.glb` files are
   CC BY-SA 4.0 and the code "can have its own licence", but the repository has no `LICENSE`. Public
   submission usually expects one. README says it is not yet stated.
9. **`models/metadata.json` `git_sha` ends in `-dirty`** (`10eadccccb...-dirty`; `docs/ml_results.md` says
   "with uncommitted changes"). The shipped models were trained from a working tree that is not any commit.
   Suggest retraining from a clean commit before submission and committing the result. See section C for a
   reproduction check.
10. **The external-validation step cannot run offline.** `python -m pipeline` stops at `external` if the UCI
    archive is unreachable; the only fallback is a cached `data/external/uci_heart_disease_4sites.csv`. The
    README documents a one-line way to build that file from the zip.
11. **`bp` is labelled "Blood pressure"** with a 90 to 120 mmHg reference range, but the data and the range are
    systolic (`docs/backend_findings.md` item 6). A diastolic value typed in by mistake would be flagged
    "low" in the Physiology tab. Suggest "Systolic blood pressure".
12. **Open items from `docs/backend_findings.md`** that affect what the documentation may claim: the point
    probability can lie outside its own 10th to 90th percentile interval (item 2); inference values are
    validated only by the API (item 4); `RiskAtlas` docstrings contradict the product structure (item 3).
13. **Screenshots will go stale.** `docs/figures/app_dashboard_*.png` and `docs/figures/viewer_*.png` are copies
    taken at commit `b795a64`. If the viewer-polish branch changes the look, replace those PNGs (the viewer ones
    are copies of `web/viewer-demo/screenshots/`), then run `python docs/build/make_figures.py app` and
    `python docs/build/build_pdf.py`. The viewer fps table in the PDF quotes `docs/viewer.md` section 6; update
    it if the polish branch re-measures.
14. **Documented but not checkable here:** the hackathon rules page was not accessible, so the AI-assistance
    wording in `README.md` and the PDF carries a TODO. The final public repository URL is also unknown: the
    README clones `https://github.com/AmanS-06/riskatlas.git` (the `origin` remote); confirm it.
15. **Independent re-analysis (not in the repo).** A separate AI-agent analysis of the same xlsx
    (`scratchpad/research/ml_skeleton/results_real/summary.md`, different splits and models) gave the same
    ordering and a similar level: CAD about 0.89 to 0.91, LAD about 0.78 to 0.83, LCX and RCA about 0.69 to 0.74
    cross-validated AUC. It agrees qualitatively with `docs/ml_results.md`; its numbers differ slightly and are
    not quoted in the documentation because they are not reproducible from the repository.
16. **Row-order finding is the documentation author's own.** The spreadsheet's row order is associated with the
    labels (AUC of row position 0.355 for CAD). The pipeline is safe against it (all splits are shuffled and
    stratified; the index is never a feature) but `docs/leakage_audit.md` does not mention it. Reproduce with
    `python docs/build/row_order_check.py` (needs the dataset); output in `docs/build/row_order_check.json`.

## C. Verification log

See the report that accompanied this branch for the commands run and their results. Summary of what could not
be verified in the sandbox: downloading either UCI dataset (the host is blocked; the dataset file used for the
retrain check was supplied separately and matches the SHA-256 in `reports/data_audit.json`), a real GPU, other
browsers, and deployment.
