# Viewer findings: inconsistencies noticed elsewhere in the repo

Found while building the 3D viewer. None of these were fixed on this branch (outside the viewer lane);
each has evidence so the owner can decide.

## 1. Band names: `amber` vs `moderate`

- `docs/TEAM_STANDARD.md` line 23: `risk_bands.yaml    # probability -> band (low/amber/high) + colours`.
- `config/risk_bands.yaml`: the ids are `low`, `moderate`, `high`, and the header says cut points are
  deliberately not in that file (they are per target, from `models/metadata.json`).
- The viewer and `docs/ml_interface.md` use `low` / `moderate` / `high`. The standard's folder comment is stale on
  both counts (name and "probability -> band").

## 2. README stack row says React Three Fiber; the viewer is vanilla three.js

- `README.md` line 31: `| Frontend | Vite + React + TypeScript, React Three Fiber |`.
- The viewer (`web/src/viewer/HeartViewer.ts`) is a framework-free class on plain three.js, by the agreed contract
  and for the reasons in the frontend research (half the bundle, on-demand rendering, direct control of the render
  loop on software GL). It can be used from React with a `useEffect` (`docs/viewer.md`). The README row should say
  "three.js (framework-free viewer class)".

## 3. Provisional band colours are borderline for red-green colour blindness

- `config/risk_bands.yaml` low `#2E9E6A`, moderate `#E0A030`, high `#D64545` (marked provisional, owner Person-3).
- Simulated with the Machado et al. 2009 matrices (severity 1.0, applied in linear sRGB, CIE76 delta E). Reproduce
  with `npm run cvd` in `web/scripts` (reads the yaml, so it follows palette changes):

  | Vision | low-moderate | moderate-high | low-high |
  |---|---|---|---|
  | normal | 74.4 | 56.1 | 101.4 |
  | protanopia | 41.5 | 51.3 | **18.2** |
  | deuteranopia | 50.8 | 30.7 | **22.9** |
  | tritanopia | 79.2 | 43.0 | 117.0 |

  Low versus high is the weakest pair under red-green deficiency (about 18 to 23, near the roughly 20 usually
  wanted for "easily told apart"). The viewer never relies on colour alone (outline, pulse, halo size, and the app
  must show the band label as `risk_bands.yaml` already requires), so this is not a blocker. A decision on the
  final palette is still open. I did not change the file.

## 4. `docs/ml_interface.md` section 6 will be stale after merge

- Section 6 says `config/features.yaml` `anchor` is "Currently empty for all features". This branch fills eight
  anchors (rationale in `docs/viewer.md`). Update that sentence when merging.

## 5. Typical `uncertainty.width` range is not documented

- `docs/ml_interface.md` section 3 says to drive vessel saturation from `uncertainty.width` ("narrow means crisp,
  wide means desaturated") but gives no scale. In `reports/example_prediction.json` the widths are 0.052 (CAD),
  0.128 (LAD), 0.145 (LCX), 0.183 (RCA).
- The viewer maps width to desaturation with `CRISP = 0.05` (no desaturation up to here) and `FULL = 0.35`
  (maximum desaturation from here on), constants in `viewerLogic.ts` (`UNCERTAINTY`). They were chosen from that one
  example, not from the distribution over many patients. Open question for the ML owner: what are the 5th and 95th
  percentiles of `width` per vessel over the holdout? The constants should follow those.

## 6. Node version in the standard vs the tooling

- `docs/TEAM_STANDARD.md` says "Node 20 for `web/`". Vite 8 (`npm view vite@8.3.2 engines`) needs
  `^20.19.0 || >=22.12.0`, so Node 20.0 to 20.18 fails. `README.md` says "Node 20" too. The viewer tooling here was
  run on Node 22.22 only (Node 20.19+ is expected to work from the engines fields, not tested).

## 7. Heartbeat and bullseye (Person-3 scope in the standard) are not part of this deliverable

- `docs/TEAM_STANDARD.md` lists "heartbeat and risk glow" and "the 17-segment bullseye overlay" for Person-3.
  The viewer implements the risk glow. A heartbeat animation was left out on purpose (it needs a continuous redraw
  loop, which costs frames on software GL and conflicts with reduced motion and on-demand rendering). The bullseye
  is not built. Recorded so nobody assumes they exist.

## 8. Attribution still has to be added to the README and the app

- The CC BY-SA 4.0 attribution for the 3D heart model must be visible in the README and in the app's About / Credits
  page (`ASSETS_AND_LICENSES.md` has the exact text; `README.md` currently has none). The viewer lane may not edit the
  README or the app shell, so this is left for their owners. Without it the model's licence condition is not met.

## 8. Legibility pass: issues found outside the viewer lane (not fixed)

Found while making the arteries the visual focus (branch `claude/viewer-polish`). Evidence is in
`web/viewer-demo/e2e/appearance.e2e.test.ts` results and `docs/viewer.md` section 3a.

1. **`heart_lite.glb` has fragmented arteries.** The Z-Anatomy economy mesh (`web/scripts/source/zanatomy_heart_economy.glb`,
   copied unchanged by `build_viewer_models.mjs`) breaks LAD, LCX and RCA into disconnected pieces where its decimation
   cut them (1,668 vessel triangles against 8,030 in the standard model); parts also sit below the surface of the
   decimated heart wall. Since the lite model is what runs on software GL (the app default there and the likely state of
   a screen recording on a VM), the arteries look ragged. The viewer now lifts and slightly thickens them, which helps,
   but the real fix is a better lite mesh: decimate the body only and keep the standard arteries (about 8k triangles,
   still far below the 150k budget), or re-run a decimation that preserves boundaries. Owner of `web/scripts` and
   `web/public/models3d`.
2. **Config palette collapses under red-green deficiency in the rendered image, not only in the swatches.** Median
   rendered pixel colours (lit and shaded) of the three bands give moderate-low delta E 6.2 (protanopia) and 9.8
   (deuteranopia) and high-moderate 8.5 and 13.8, worse than the swatch numbers of item 3, because lighting shifts
   amber toward the tan of the body. The app's colour-blind-safe palette keeps every pair at or above 17 (deuteranopia
   crimson against orange) and usually above 30. Consider making the safe palette the default, or at least offering it
   prominently next to the 3D view. Owner of `config/risk_bands.yaml` and `web/src/shared/theme.css`.
3. **The web app's e2e selector `[data-vessel=LCX]` in `web/tests/e2e/run.mjs` assumes the stub viewer's SVG.** Any real
   viewer markup that uses `data-vessel` is clicked by that test (it dispatches `click` and expects the dashboard to react),
   which fails with a real canvas. The branch avoids the name (labels use `data-label`), but the test should be
   conditioned on `svg` or on the stub, not on the attribute. Owner of `web/tests/e2e`.
4. **`web/src/viewer/**` is excluded from the web app's `vitest` run** (`web/vite.config.ts` `test.exclude`), so
   `cd web && npm test` does not run the viewer's unit tests; they run with `cd web/viewer-demo && npm test`. Easy to miss
   in a CI that runs only `web/`.
5. **One flaky app unit test under load.** `src/dashboard/Dashboard.test.tsx` "paused" case failed once
   (`prob-CAD` still present) while another job was using the CPUs and passed on every rerun (3 of 3). Not related to
   the viewer; probably a missing `await`/`waitFor` after the paused state.
6. **`npm run lint` in `web/` lints `web/viewer-demo/dist`** (the ignore pattern `dist` only matches `web/dist`). After
   any `npm run test:e2e` in `web/viewer-demo` the demo build output makes lint report about 1,500 errors, plus one
   irregular-whitespace error in `web/viewer-demo/e2e/viewer.e2e.test.ts` line 487. Add `viewer-demo/dist` to the
   eslint ignores.
