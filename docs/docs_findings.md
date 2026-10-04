# Documentation findings

Inconsistencies and gaps found while writing `README.md`, `docs/PROJECT_DOCUMENTATION.md` and the PDF
(2026-10-04; first written against `b795a64`, then updated after merging `claude/integration` at `59d0144`). The documentation author could only edit `README.md`,
`ASSETS_AND_LICENSES.md`, `docs/PROJECT_DOCUMENTATION.*`, `docs/figures/`, `docs/build/` and
`docs/CONTRIBUTORS.md`, so everything in section B is left for the lead. Each item has its evidence.

## A. Fixed in files the documentation author owns

| # | Was | Now |
|---|---|---|
| A1 | `README.md` said "Backend and frontend setup will be added here" and had TBD team rows | Full setup, test and troubleshooting sections; team table with real names and TBD roles |
| A2 | `README.md` stack row said "React Three Fiber" | Says the viewer is a framework-free three.js class wrapped by one React component (matches `web/src/viewer/HeartViewer.ts`, `docs/viewer_findings.md` item 2) |
| A3 | `README.md` said "Node 20" | `^20.19.0` or `>=22.12.0`, because Vite 8 requires it (`web/package.json` engines; `docs/viewer_findings.md` item 6). Tested on Node 22.22.0 only |
| A4 | `README.md` had no CC BY-SA attribution | Exact attribution text added (`docs/viewer_findings.md` item 8); dataset citations added |
| A5 | README disclaimer was the old API wording | Now the UI wording (`web/src/shared/constants.ts` `DISCLAIMER`). The integration branch has since changed the API and `docs/api.md` to the same wording, so item B1 below is resolved |
| A6 | `README.md` said tests that need data or models "skip on a fresh clone" | Models are committed, so only 3 tests that need the dataset skip (97 pass, 3 skip, verified) |
| A7 | `ASSETS_AND_LICENSES.md` Fonts row was TBD; dataset row said "59 features" | Fonts row filled (system font stack, plus the two fonts embedded in the PDF); "59 columns (55 candidate inputs and 4 outcome columns)", checked against the xlsx (303 x 59) |
| A8 | `README.md` layout listed `common/`, `cv/`, `slm/` as if populated | Marked as empty placeholders |

## B. For the lead (files outside the documentation author's scope)

1. **Disclaimer wording: resolved on `claude/integration`** (`api/schemas.py` and `docs/api.md` now use the UI wording; checked: `GET /meta` returns it). Nothing to do.
2. **`docs/TEAM_STANDARD.md` is stale in three places.** It says the band names are `low/amber/high` (config ids
   are `low`, `moderate`, `high`), "Node 20" (needs 20.19+), and `risk_bands.yaml # probability -> band` (cut
   points are per target, in `models/metadata.json`).
3. **`docs/ml_interface.md` section 6** still says the `anchor` field is "Currently empty for all features";
   `config/features.yaml` has eight anchors (`docs/viewer_findings.md` item 4).
4. **`.env.example` uses names the code does not read.** `API_HOST`, `API_PORT` and `VITE_API_BASE_URL` appear
   nowhere in `api/`, `pipeline/` or `web/` (grep). The code reads `VITE_API_BASE`, `VITE_API_MOCK`,
   `VITE_API_PROXY`, `API_CORS_ORIGINS`, `API_CACHE_FAST`, `API_CACHE_FULL`, `API_WARMUP`. The README
   documents the real names. (Also `docs/backend_findings.md` item 8.)
5. **`npm run lint` fails and `npm run format:check` reports files** on the committed tree (checked again on the merged tree: one error, plus about 1,500 more after any viewer-harness build because lint scans `web/viewer-demo/dist`, `docs/viewer_findings.md` item 8.6):
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
13. **Screenshots were retaken on the final build** (`59d0144`): `app_dashboard_*` (1920x1080) and `app_phone_high` from the app against the real backend (no MOCK banner; checked in the script), `app_viewer_*` cropped from the same app, `viewer_*` copied from `web/viewer-demo/screenshots/`. They go stale if the viewer or layout changes again. To refresh, replace those PNGs, then run `python docs/build/make_figures.py app` and
    `python docs/build/build_pdf.py`. The viewer fps table in the PDF is now our own re-measurement of the final build (`docs/build/viewer_fps_run1.json`, `run2.json`), not a copy of `docs/viewer.md`: default 32.2 and 33.4 fps at 1280x800 (viewer.md after-polish table: 28.7 to 31.5), 1080p 21.9 and 19.5, full quality 17.5 and 17.6, phone 56.8 and 57.3. Run-to-run noise is about 30%.
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

17. **Reruns reproduce the final models but not the cross-validated estimates bit for bit.** `docs/ml_methods.md`
    section 13 says "Training is deterministic: rerunning it reproduces the same models". Checked on 2026-10-04
    (clean copy, same dataset hash, pinned libraries, `python -m pipeline audit train evaluate explain analysis
    counterfactual report`; `external` could not download): the final models have the same families, the same cut
    points (difference 1e-14) and identical probabilities on 30 random inputs (difference 3e-14), and the same
    top SHAP drivers. The procedure cross-validation differs slightly: headline ROC-AUC CAD 0.9183 vs 0.9187, LAD
    0.8354 vs 0.8375, LCX 0.7201 vs 0.7250, RCA 0.7279 vs 0.7328; outer-fold family choices differ (LCX: lr 6, rf 4
    vs lr 8, rf 2); out-of-fold sensitivities differ by up to about 0.02. All inside the intervals. Likely
    multi-threaded fitting or parallel jobs, not investigated. The committed `reports/` and `docs/ml_results.md`
    are the numbers quoted everywhere. Suggest softening the "deterministic" sentence, or fixing the source
    (single-threaded XGBoost and `n_jobs=1` in the procedure CV). Details: `docs/build/retrain_check.json`
    (`python docs/build/compare_retrain.py <retrained copy>`). Wall time of the full pipeline: about 30 minutes on a
    shared 4-core VM (`docs/ml_results.md` and the README say about 15 minutes on a recent laptop).
18. **One viewer browser test is load-sensitive.** In `web/viewer-demo`, `npm run test:e2e` failed once ("wheel zoom
    and drag rotate move the view; resetView() returns to the start": expected 128.3 to be less than 1.5) while the
    machine load average was about 14, and all 35 passed on a re-run at a load of about 8. The test depends on a
    0.5 s camera tween finishing in time. `docs/viewer.md` says only the TIMING tests depend on machine speed.
19. **The app's default look on a VM is the lite model.** On software GL the viewer picks `heart_lite.glb`, whose arteries are
    fragmented (`docs/viewer_findings.md` item 8.1), so the in-app screenshots look ragged next to the standard-model
    harness shots. The documentation shows both and says which is which. If the demo video is recorded on a VM, fix the
    lite mesh first (that item's suggestion).
20. **Counts changed after integration** and are quoted accordingly: 188 Vitest tests (was 182), 33 app browser tests with
    the real-backend suite (was 25), viewer harness 65 unit and 51 browser tests (was 47 and 35). pytest is unchanged
    (97 passed, 3 skipped).

## C. Verification log

Run on 2026-10-04 in a clean copy made with `git archive` of the base commit `b795a64`; the rows marked (final) were repeated on the merged tree `59d0144` (Python 3.11.15, Node 22.22.0,
npm 10.9.4, Chromium from `/opt/pw-browsers`):

| Command | Result |
|---|---|
| `python3.11 -m venv .venv && pip install -r requirements.txt` | succeeded |
| `python -m pytest` | 97 passed, 3 skipped (need the dataset), about 55 s; (final) the same, 51 s |
| `uvicorn api.main:app --port 8000` | healthy after about 14 s; `POST /predict/fast` and `/predict` answered (full 3.9 s); a request with key `LAD` gave HTTP 422 `leakage` |
| `API_MOCK=1 uvicorn api.main:app` | `/health` says `mock`; header `x-riskatlas-mock: true` |
| `cd web && npm ci` | succeeded |
| `npm test` | 11 files, 182 tests passed; (final) 188 passed |
| `npm run build` | succeeded |
| `npm run dev` (port 5173 was taken, so Vite chose 5175), `npm run preview` (4173) | `/api/health` and `/api/meta` reach the backend through the proxy |
| `E2E_REAL_API=http://127.0.0.1:8000 npm run e2e` | 25 passed, 0 failed, about 2 min 16 s; (final) 33 passed, 0 failed |
| `?mock=1` and `VITE_API_MOCK=1` | the "MOCK DATA - not a real prediction" chip is shown; absent without them |
| `npm run typecheck` | passed |
| `npm run lint`, `npm run format:check` | **fail** (item 5) |
| `cd web/viewer-demo && npm ci && npm test` | 47 passed; (final) 65 passed |
| `npm run test:e2e` (viewer-demo) | 35 passed on re-run; 34 of 35 on the first run under load (item 18); (final) 51 passed in each of two runs, which also produced the fps numbers in item 13 |
| `npm run build` (final) | succeeded; `npm run typecheck` passed |
| `python -m pipeline` on the raw xlsx in `data/raw/` | audit, train, evaluate, explain ran (train 25 min on a loaded VM); `external` stopped because the UCI archive is unreachable; then `python -m pipeline analysis counterfactual report` ran (item 17) |
| The README's `python -c "... parse_zip ..."` snippet | ran on a synthetic four-file zip; not on the real archive |
| `python docs/build/gen_tables.py --check`, `python docs/build/check_links.py` | OK |

Could not be verified in the sandbox: downloading either UCI dataset (host blocked; the xlsx used for the retrain
was supplied separately and has the SHA-256 in `reports/data_audit.json`), `git clone` from GitHub (the same
tree was obtained with `git archive`), a real GPU, browsers other than Chromium, Node 20, Windows or macOS, and
any deployment.
