# Documentation findings

Inconsistencies and gaps found while writing `README.md`, `docs/PROJECT_DOCUMENTATION.md` and the PDF. First written
on 2026-10-04 against `b795a64`, revised after merging the integration branch, and revised again on 2026-10-05
against `AmanS-06/RiskAtlas` main (`229f82c`). The documentation author edits only
`README.md`, `ASSETS_AND_LICENSES.md`, `docs/PROJECT_DOCUMENTATION.*`, `docs/figures/`, `docs/build/` and this file,
so everything in section B is left for the lead. Each item has its evidence.

## A. Fixed in files the documentation author owns

| # | Was | Now |
|---|---|---|
| A1 | `README.md` said "Backend and frontend setup will be added here" and had TBD team rows | Full setup, test and troubleshooting sections; team table with real names and TBD roles |
| A2 | `README.md` stack row said "React Three Fiber" | States that the viewer is a framework-free three.js class wrapped by one React component |
| A3 | `README.md` said "Node 20" | `^20.19.0` or `>=22.12.0`, because Vite 8 requires it. Tested on Node 22.22.0 only |
| A4 | `README.md` had no CC BY-SA attribution | Exact attribution text added, plus the dataset citations |
| A5 | README disclaimer was the old API wording | The UI wording (`web/src/shared/constants.ts`); the API and `docs/api.md` now use it too |
| A6 | Test counts, "not deployed", licence sentence, `common/`, `cv/`, `slm/` | Counts re-measured on the final tree (section C); one-process production mode described; the stale "licence not yet stated" sentence removed because `LICENSE` (MIT) now exists; empty folders marked as placeholders |
| A7 | `ASSETS_AND_LICENSES.md`: Fonts row TBD, "59 features" | Fonts row filled; "59 columns (55 candidate inputs and the 4 outcome columns)", checked against the xlsx; a line saying the code is MIT |
| A8 | PDF and README quoted the old, non-deterministic SHAP numbers and a lock/reseed workaround | Updated to the deterministic explainer (`docs/shap_reproducibility.md`) |
| A9 | The Windows troubleshooting entry in the README (added by someone else) quotes "97 passed, 3 skipped" | Kept, but marked as reported when it was added and not re-run here, since the suite is now 189 passed |

## B. For the lead (outside the documentation author's files)

1. **`docs/TEAM_STANDARD.md` is still stale.** It says the band names are `low/amber/high` (the config ids are `low`,
   `moderate`, `high`; line 23), and "Node 20" (lines 69 and 158; Vite 8 needs 20.19 or 22.12).
2. **`docs/ml_interface.md` section 6** still says the `anchor` field is "Currently empty for all features";
   `config/features.yaml` has eight anchors.
3. **`npm run lint` fails and `npm run format:check` flags files** on the final tree. Lint: one error,
   `viewer-demo/e2e/viewer.e2e.test.ts:623:130 Irregular whitespace not allowed`; after any `viewer-demo` build lint also
   scans `viewer-demo/dist` and reports about 3,000 errors (`docs/viewer_findings.md` item 8.6; add
   `viewer-demo/dist` to the eslint ignores). Prettier: 23 files. `typecheck`, `npm test` and `npm run e2e` pass. The README
   does not claim lint passes.
4. **SHAP callouts are not pinned to the 3D anatomy in the app.** `TEAM_STANDARD.md` lists "SHAP drivers pinned to
   anatomy"; the viewer implements `setAnchors` / `onAnchors` and `features.yaml` has eight anchors, but nothing outside
   `web/src/viewer/` calls them (grep). The documentation says so. The chips on the arteries show risk, not SHAP drivers.
5. **Heartbeat animation and the 17-segment bullseye are not built** (`docs/viewer_findings.md` item 7); the
   documentation says so. `cv/`, `slm/`, `common/` and `notebooks/` are empty folders.
6. **`models/metadata.json` `git_sha` ends in `-dirty`** (`10eadccccb...-dirty`; `docs/ml_results.md` says "with
   uncommitted changes"). The shipped models were trained from a working tree that is not any commit. Suggest retraining
   from a clean commit before submission (item 12 shows the result should not change).
7. **The external-validation step cannot run offline.** `python -m pipeline` stops at `external` if the UCI archive is
   unreachable; the only fallback is a cached `data/external/uci_heart_disease_4sites.csv`. The README documents a
   one-line way to build that file from the zip (run on a synthetic zip only).
8. **`bp` is labelled "Blood pressure"** with a 90 to 120 mmHg reference range, but the data and the range are systolic
   (`docs/backend_findings.md` item 6). A diastolic value typed in by mistake would be flagged "low".
9. **Open items from `docs/backend_findings.md`** that affect what the documentation may claim: the point probability
   can lie outside its own 10th to 90th percentile interval (item 2); inference values are validated only by the API
   (item 4). Item 1 (SHAP) is fixed at the source; `api/service.py` still takes the lock and reseeds, which
   `docs/shap_reproducibility.md` section 7 says is now redundant.
10. **`docs/viewer.md` section 6 quotes fps from an earlier, faster session.** Re-measured here with the same tests on
    the final tree: default 22.6 and 17.9 fps at 1280x800, low-power with the standard model 17.7 and 16.5, full quality
    12.2 and 10.8, 1080p 15.4 and 16.7, phone 39.5 and 37.5. The previous build (`59d0144`) in the same session gave 23.4,
    17.5, 11.9, 17.1 and 42.6, so the drop is the machine (4 vCPU, load average 2 to 4), not the viewer. Earlier
    sessions of the same build family gave 32.2 and 33.4 for the default case. The PDF quotes our own table and says so;
    raw output in `docs/build/viewer_fps_*.json`. Run-to-run noise is about 30%.
11. **The app's default look on a VM is the lite model**, whose arteries are fragmented
    (`docs/viewer_findings.md` item 8.1), so the in-app screenshots look ragged next to the standard-model harness
    shots. Both are shown and labelled. If the demo video is recorded on a VM, fix the lite mesh first.
12. **Reruns reproduce the final models but not the cross-validated estimates bit for bit.** `docs/ml_methods.md`
    section 13 says "Training is deterministic: rerunning it reproduces the same models". Checked on 2026-10-04
    (clean copy, same dataset hash, pinned libraries, `python -m pipeline audit train evaluate explain analysis
    counterfactual report`; `external` could not download): same families, same cut points (difference 1e-14), identical
    probabilities on 30 random inputs (3e-14). The procedure cross-validation differs slightly: headline ROC-AUC CAD
    0.9183 vs 0.9187, LAD 0.8354 vs 0.8375, LCX 0.7201 vs 0.7250, RCA 0.7279 vs 0.7328; outer-fold family choices differ
    (LCX: lr 6, rf 4 vs lr 8, rf 2); out-of-fold sensitivities by up to about 0.02. All inside the intervals. Likely
    multi-threaded fitting or parallel jobs; not investigated. The committed `reports/` and `docs/ml_results.md` are
    the numbers quoted everywhere. Suggest softening the "deterministic" sentence or fixing the source. Details:
    `docs/build/retrain_check.json` (`python docs/build/compare_retrain.py <retrained copy>`). The retrain took about 30
    minutes on a loaded shared 4-core VM (the README says about 15 on a recent laptop). This check predates the SHAP fix.
13. **Global SHAP tables were not regenerated after the SHAP fix** (`docs/shap_reproducibility.md` section 6: the raw
    dataset was not available there). `reports/shap_global_*.csv`, Figure 3 and the top-5 table in the PDF come from the
    old explainer; the proxy check says the top-10 sets are unchanged and ranks 3 to 5 may swap among near-ties. Rerun
    `python -m pipeline explain` on the data, then `python docs/build/make_figures.py shap`, `gen_tables.py --write` and
    `build_pdf.py`. `reports/example_prediction.json` and the web mock also still hold the old LAD, LCX and RCA SHAP numbers.
14. **Documented but not checkable here:** the hackathon rules page was not accessible, so the AI-assistance wording in
    `README.md` and the PDF carries a TODO (left as is, the team has not decided). The README clones
    `https://github.com/AmanS-06/riskatlas.git` (the `origin` remote); confirm the final public URL. `Eshaan [surname]`
    and every role are placeholders.
15. **Independent re-analysis (not in the repo).** A separate independent analysis of the same xlsx (different splits and
    models) gave the same ordering and a similar level: CAD about 0.89 to 0.91, LAD about 0.78 to 0.83, LCX and RCA about
    0.69 to 0.74 cross-validated AUC. It agrees qualitatively with `docs/ml_results.md`; its numbers differ slightly and
    are not quoted, because they are not reproducible from the repository.
16. **Row-order finding is the documentation author's own.** The spreadsheet's row order is associated with the labels
    (AUC of row position 0.355 for CAD). The pipeline is safe against it (all splits are shuffled and stratified; the
    index is never a feature) but `docs/leakage_audit.md` does not mention it. Reproduce with
    `python docs/build/row_order_check.py` (needs the dataset); output in `docs/build/row_order_check.json`.
17. **One viewer browser test is load-sensitive.** `npm run test:e2e` in `web/viewer-demo` failed once ("wheel zoom and drag
    rotate move the view; resetView() returns to the start", on the earlier tree) while the machine load average was
    about 14, and passed on re-run. On the final tree all 56 passed in both runs.
18. **First `python -m pytest` on a fresh tree skips one more test** than the second: `tests/test_api_static.py` skips its
    real-build test until `web/dist` exists. 188 passed and 4 skipped before `npm run build`, 189 passed and 3 skipped
    after. The README says so.
19. **Docker and Windows paths are untested** (by their authors' own account in `docs/DEPLOY.md` section 8: no Docker
    daemon, `scripts/serve_prod.ps1` read but not run). Nothing in this documentation claims otherwise.
20. **A broken link in `docs/DEPLOY.md`.** `docs/build/check_links.py` reports `docs/DEPLOY.md: broken link -> docs/DEPLOY.md`
    (a link written relative to the repository root inside a file that is already in `docs/`; it should be `DEPLOY.md`
    or `../README.md`). Not fixed here (not a documentation-lane file). Every other link in the Markdown files resolves.

## C. Verification log

Run on 2026-10-05 in a clean copy made with `git archive` of this branch (`229f82c` plus the documentation commits),
Python 3.11.15 (the venv `/home/user/work/venv_numba65`), Node 22.22.0, npm 10.9.4, Chromium 141 from `/opt/pw-browsers`,
a 4-vCPU VM with no GPU:

| Command | Result |
|---|---|
| `python -m pytest` (before `npm run build`) | 188 passed, 4 skipped, 146 s (item 18) |
| `python -m pytest` (after the build) | **189 passed, 3 skipped** (the 3 need the dataset), 118 s |
| `cd web && npm ci && npx tsc --noEmit` | succeeded |
| `npm test` | 11 files, **193 passed** |
| `npm run build` | succeeded (JS 312 kB plus a 690 kB viewer chunk, before gzip) |
| `uvicorn api.main:app --port 8000` after the build | healthy after about 16 s; serves `/` as `text/html`, `/api/health` ok, `/api/nope` is a JSON 404 |
| `PROD_URL=http://127.0.0.1:8000 node tests/e2e/prod.mjs` | **5 passed, 0 failed** (no MOCK banner, one origin, case C gives CAD 96%, About tab credits, JSON 404 and cache headers) |
| `E2E_REAL_API=http://127.0.0.1:8000 npm run e2e` | **38 passed, 0 failed** (33 mock and HTTP suites plus 5 against the real backend) |
| `cd web/viewer-demo && npm ci && npm test` | **72 passed** |
| `npm run test:e2e` in `web/viewer-demo` | **56 passed** in each of two runs, which also gave the fps in item 10 |
| Screenshots in `docs/figures/` | taken with Playwright against the production server above (real models, no mock chip; the script fails if the MOCK banner is present); harness images are byte-identical to the committed `web/viewer-demo/screenshots/` |
| `python docs/build/gen_tables.py --check`, `python docs/build/check_links.py` | OK |
| PDF | `pdfinfo`: 6 pages, A4; `pdffonts`: all fonts embedded; every page looked at |

Could not be verified in the sandbox: downloading either UCI dataset (host blocked; the xlsx used for the earlier
retrain was supplied separately and has the SHA-256 in `reports/data_audit.json`), `git clone` from GitHub (the same tree
was obtained with `git archive`), `docker build`, a real GPU, browsers other than Chromium, Node 20, Windows or macOS,
the PowerShell script, and any deployment.
