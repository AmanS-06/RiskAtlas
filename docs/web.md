# RiskAtlas web app

The web app is the clinical dashboard and the host of the 3D viewer. It is a Vite + React + TypeScript project in `web/`. Everything it shows (input form, units, reference ranges, vessels, risk bands, colours, cut points) is read from `GET /meta`, which the API builds from `config/`. Nothing about features, vessels or thresholds is hardcoded in the TypeScript.

Findings about inconsistencies in the config, docs and API (not fixed here) are in [docs/web_findings.md](web_findings.md).

## Setup

Requirements: **Node `^20.19.0 || >=22.12.0`** (Vite 8 needs this; `engines` in `web/package.json` states it) and npm 10. The `npm run palette` helper runs a `.ts` file directly and needs Node 22.18 or newer; nothing else does.

```bash
cd web
npm ci                     # exact versions from package-lock.json
npm run dev                # http://localhost:5173, /api is proxied to http://localhost:8000
```

Start the backend in another terminal from the repo root: `uvicorn api.main:app --port 8000` (add `API_MOCK=1` for the API's own mock payload). No backend yet? Open `http://localhost:5173/?mock=1`.

Browser-only tests (`npm run e2e`) drive the Chromium that Playwright already installed (`/opt/pw-browsers` or `PLAYWRIGHT_BROWSERS_PATH`); set `E2E_CHROMIUM` to any `chrome` executable otherwise. `playwright-core` never downloads a browser.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server with the `/api` proxy |
| `npm run build` | type-check, then production build into `web/dist` |
| `npm run preview` | serves `dist` on :4173 with the same `/api` proxy |
| `npm test` | vitest unit and component tests (jsdom) |
| `npm run e2e` | Playwright end-to-end tests in real headless Chromium, mock mode (includes layout checks: results card inside the viewport at 1920x1080 and 1440x900, sticky heart, cached label; screenshots go to `tests/e2e/shots/`) |
| `E2E_REAL_API=http://127.0.0.1:8000 npm run e2e` | the same plus a suite against a running backend |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | static checks |
| `npm run sync:mock` | regenerate `src/api/mock/*.json` from `config/`, `models/metadata.json` and `reports/example_prediction.json` |
| `npm run palette` | colour-blind distinguishability of the config palette and the safe palette |

## Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `VITE_API_BASE` | browser | API location. Default `/api`. Set to a full URL (for example `https://api.example.org`) when the API is on another origin; then the API must allow the web origin in `API_CORS_ORIGINS`. |
| `VITE_API_MOCK=1` | browser | start in mock mode. `?mock=1` in the URL does the same for one page load. |
| `VITE_API_PROXY` | dev and preview server only | where `/api` is proxied to. Default `http://localhost:8000`. The `/api` prefix is stripped, because the backend serves `/meta`, `/predict` and so on at its root. |

`web/.env.example` lists them. Never commit `.env.local`.

## Architecture

```text
web/src
├── api/          typed client: types.ts (wire types, mirror api/schemas.py), client.ts (HttpProvider),
│                 live.ts (LivePredictor: debounce, abort, drop stale), errors.ts, mock/ (MockProvider + generated JSON)
├── dashboard/    Dashboard.tsx (page), useDashboard.ts (all state), PatientForm + FeatureField (form from /meta),
│                 ResultsPanel (overall, vessels, legend), analysis.tsx (explanation, physiology, what-if, about),
│                 form.ts / shap.ts (pure logic), risk.tsx (gauge, bar, band chip), presets.json
├── shared/       theme.css (the only file with colours), layout.css, Disclaimer, SiteHeader, ViewerCanvas,
│                 viewerAdapter.ts (the one place that picks the viewer), palette.ts, color.ts, format.ts
└── viewer/       3D scene (owned by the viewer track). __stub__/HeartViewerStub.ts is a placeholder with the same interface.
```

**Data flow.** `GET /meta` builds the form (control type per feature, groups in `meta.groups` order), the band chips and the legend. Edits go to `LivePredictor`:

- while a slider is dragged or a number is typed, `preview()` sends a debounced `POST /predict/fast` (150 ms quiet time, but at least one request every 300 ms during a continuous drag). Vessel colours update live; the explanation on screen is marked as from the previous full prediction.
- on release, blur, a select/toggle change, a preset, or the **Predict risk** button, `commit()` sends `POST /predict` (full: uncertainty, SHAP, counterfactuals). A blur that changed nothing sends nothing.
- a request is aborted when a newer one of the same kind starts; a preview also cancels a stale full request; a reply is applied only if it is newer than what is shown, so replies that arrive out of order are dropped. Timeouts: 6 s fast, 30 s full, 8 s meta.
- errors map to `ApiError` kinds: `network`, `timeout`, `validation` (422), `leakage` (422), `unavailable` (503), `server`, `bad_response`. The last good result stays on screen and the next edit retries. If `/meta` cannot be loaded the page says so, with Retry and an explicit "Use mock data instead".

The request body is a flat dict of canonical feature names to numbers (`docs/ml_interface.md` section 2); blank fields are left out and come back in `input.missing`.

**Mock mode.** `MockProvider` serves `reports/example_prediction.json`-shaped data without a backend. SHAP contributions are scaled by how far each entered value sits from the training median relative to the example patient, so sliders visibly move the numbers; probabilities stay additive and vessels never exceed CAD. Every mock screen carries the badge "MOCK DATA - not a real prediction" (header and results panel). The backend's own `API_MOCK=1` is flagged the same way through `mock: true` in the response.

**Viewer.** `shared/viewerAdapter.ts` is the only module that imports a viewer. It exports `HeartViewer` (interface in `HeartViewer.ts` of the viewer track). The dashboard passes `{probability, band, color, uncertaintyWidth}` per vessel mesh, taking the colour from the `/meta` bands or the safe palette. To switch from the stub to the real viewer, change the two import paths in `viewerAdapter.ts` from `../viewer/__stub__/HeartViewerStub` to `../viewer/HeartViewer` (`three@0.186.1` and `@types/three@0.186.0` are already in `package.json`). The viewer is loaded with a dynamic `import()`, so three.js is a separate chunk and the dashboard paints first. `setVessels({ LAD: undefined })` clears a vessel to neutral; the dashboard uses that on Reset. The viewer track's own tests live in `web/viewer-demo` and are excluded from `npm test`. Selecting a vessel in the viewer selects the same target in the dashboard and the other way round.

**Layout.** From 1024 px wide (and at least 600 px tall) the page is two columns: the left one (3D heart plus a compact results card: overall CAD, LAD, LCX, RCA with probability, band, bar and interval, one line each) is `position: sticky`, so the heart and every probability stay in view while the right column (tabs Inputs, Explanation, Physiology, What-if, About) scrolls with the page. The banner and header heights are measured at run time into `--banner-h` and `--header-h` (`shared/useCssHeight.ts`); the left column is exactly as tall as what is left of the screen below them, so at scroll position 0 it fits the viewport (checked by the e2e tests at 1920x1080 and 1440x900; at 1366x768 the heart and the four rows fit and the notes line below them scrolls inside the column). The viewer height is computed from the screen and a reserved results height (`--results-reserve` in `layout.css`), not left to flex, because the 3D camera is framed once for the size it was loaded at and a viewer that resizes whenever a result arrives would crop the heart. Below 1024 px (phones, tablets) the layout is the natural stacked flow with 16 px gutters and nothing is sticky except the disclaimer banner. Results rows switch to the one-line layout through a container query on the results card, not the screen width. The cut-point note, the consistency check (when it passes; a failed check stays visible), the data-limits sentence and the repeated disclaimer sit in one collapsed "Cut points, consistency check, data limits, clinical safety" block under the card; the persistent banner at the top of the viewport is the disclaimer that is always visible.

**Cached answers.** The API sets `X-Cache: HIT|MISS` on `/predict` and `/predict/fast`, and on a hit overwrites `timing_ms.total` with the time spent copying the stored answer (about 0.05 ms), so the original latency is lost. The client copies the header into `cached` on the prediction (a client-side field, not part of the API body) and the status line reads "Full prediction (cached answer, no new model run)." A fresh answer shows its measured time ("Full prediction in 3812 ms."); a missing header (mock mode) shows no time. The flag is never inferred from the timings.

**Theme.** All colours, fonts and spacing are CSS variables in `src/shared/theme.css`, in three blocks: light, dark by `prefers-color-scheme`, and `data-theme="dark"` (the header toggle cycles System, Light, Dark). Components use `var(--...)` only. Risk-band colours are the exception by design: they come from `config/risk_bands.yaml` through `/meta`. `theme.test.ts` checks WCAG contrast of every text pair in both themes, so a restyle that breaks AA fails `npm test`.

**Accessibility.** One `h1`; landmarks `aside` (disclaimer), `header`, `main`; tabs follow the WAI-ARIA pattern with arrow keys; vessel rows are real buttons with `aria-pressed`; results changes are announced through one polite live region (debounced, so dragging a slider does not chatter); every control has a visible label and a 3 px focus ring; risk is never colour alone (band text and an icon that fills with risk, explanation direction glyphs ▲/▼ plus signed text); `prefers-reduced-motion` is honoured.

## How to extend without code changes

| Change | What to edit |
|---|---|
| New clinical feature | add it to `config/features.yaml` (name, label, type, unit, range, group), retrain. The API serves it in `/meta`; the form shows it in its group, validates it, and the explanation and physiology panels pick it up. |
| New feature group | give features a new `group` value; groups appear in the order the API returns them. |
| New vessel | add a target with a `mesh` to `config/manifest.yaml` and a node with that name to the `.glb`. The results list, legend, target tabs and what-if panel add it. The viewer's `VesselId` type must accept the name. |
| New model or retrained cut points | retrain; `/meta` and every response carry the new cut points and the legend follows. |
| New risk colours or band labels | `config/risk_bands.yaml` (keep exactly three bands for the ML pipeline). |
| Restyle | `web/src/shared/theme.css` only. |
| New illustrative patient | `web/src/dashboard/presets.json` (canonical feature names; `form.test.ts` validates them against `/meta`). |

## Known limits

- Presets were picked by running them through the models trained on 4 Oct 2026 (case A low, B moderate, C high); re-check after a retrain.
- The what-if panel shows the model's counterfactual for the selected target as the API computed it. "Try these values in the form" copies the suggested values into the form; it is an exploration aid, never advice.
- The 3D view colours whole vessels. It does not locate lesions within a vessel, and the UI says so.
- Form bounds come from the training statistics in `/meta` (see web_findings.md section 6), not from clinical limits.
- Not tested: Safari and Firefox (only Chromium), real touch hardware, deployment.

## Frontend (ready to paste into the root README)

```markdown
## Frontend

Vite + React + TypeScript in `web/` (Node 20.19+ or 22.12+). The dashboard builds itself from `GET /meta`, so adding a feature, vessel or model needs no frontend code change. Details: [docs/web.md](docs/web.md).

    cd web
    npm ci
    npm run dev          # http://localhost:5173, /api proxied to the backend on :8000
    npm test             # unit and component tests
    npm run e2e          # browser tests (Playwright on the preinstalled Chromium)

Run the backend with `uvicorn api.main:app --port 8000`. Without a backend, open `http://localhost:5173/?mock=1`: the app then shows a fixed example payload, flagged "MOCK DATA - not a real prediction". Environment variables: `VITE_API_BASE`, `VITE_API_MOCK`, `VITE_API_PROXY` (see `web/.env.example`).
```
