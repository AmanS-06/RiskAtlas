# Web app: findings about the config, docs and API

Things found while building `web/` that look inconsistent or risky. None of them was fixed outside `web/`: the owners decide. Each item has the evidence and what the web app does about it.

## 1. The config risk palette is weak for protanopia and deuteranopia

`config/risk_bands.yaml` (provisional colours: low `#2E9E6A`, moderate `#E0A030`, high `#D64545`). Measured with `npm run palette` (Machado 2009 simulation, CIE76 colour difference; about 20 or more reads as clearly different):

| Vision | dE low-moderate | dE moderate-high | dE low-high | L* low, moderate, high |
|---|---|---|---|---|
| normal | 74.5 | 56.1 | 101.4 | 58, 70, 51 |
| protanopia | 41.5 | 51.3 | **18.2** | 60, 67, 43 |
| deuteranopia | 50.8 | 30.7 | **22.9** | 56, 72, 55 |
| tritanopia | 79.2 | 43.0 | 117.0 | 58, 70, 51 |

Low and high differ by only 18 to 23 units for the two most common kinds of colour blindness, and lightness is not monotonic with risk (moderate is the lightest), so a greyscale or colour-blind reading cannot rank the bands by brightness.

What the web app does: the config palette stays the default (config is not changed). Risk is never shown by colour alone: every band has a text label and an icon that fills with risk. A header toggle, "Colour-blind safe palette", swaps in the ramp `--safe-band-0..2` from `web/src/shared/theme.css` (`#b4e4fa`, `#e89a2e`, `#8e0f35`; light blue, amber, crimson). Measured with the same script:

| Vision | dE low-moderate | dE moderate-high | dE low-high | L* low, moderate, high |
|---|---|---|---|---|
| normal | 87.7 | 71.0 | 89.4 | 88, 70, 30 |
| protanopia | 82.0 | 76.5 | 68.3 | 90, 66, 23 |
| deuteranopia | 83.0 | 59.3 | 64.2 | 87, 72, 34 |
| tritanopia | 76.2 | 39.8 | 104.1 | 88, 69, 32 |

`web/src/shared/theme.test.ts` keeps these guarantees (dE of at least 35 and lightness falling with risk under all four visions). Suggested action for Person-3: pick colours for `risk_bands.yaml` that pass the same check, or adopt the safe ramp.

## 2. Disclaimer wording differs between the README, the API and the web app

README: "RiskAtlas is for decision support and educational purposes only. It is not a substitute for formal diagnostic imaging or clinical judgement, and it must not be used to make patient care decisions." The API returns the same sentence in `/meta.disclaimer` and with every prediction (`api/schemas.py` `DISCLAIMER`).

The web app uses the wording specified for it: "RiskAtlas is a research prototype for decision support and educational purposes only. It is not a medical device, does not provide a diagnosis, and is not a substitute for formal diagnostic imaging or clinical judgement." (`web/src/shared/constants.ts`). It does not display the API's string. The team should pick one wording and use it everywhere (docs, video, README, API).

## 3. `/meta` does not expose discrimination or calibration metrics

The About panel shows what `/meta` serves: patients trained on, validation protocol, model family, prevalence and the three cut points per target. AUC, Brier and the other metrics exist only in `reports/performance_metrics.csv` and `docs/ml_results.md`, which the browser cannot read. The panel points to `docs/ml_results.md` instead of typing numbers. If the team wants the headline metrics on screen, `/meta` should serve them (for example `targets[].metrics`), generated from `reports/`. In mock mode `/meta.model` is `null` (by design in `api/service.py`), so the "trained on N patients" line is absent there and the UI says so.

## 4. "Each physiological measurement" covers only features with a reference range

`physiology` in the response contains the 18 numeric features that have a `range` in `config/features.yaml`. `age` and `function_class` (numeric, no range) and every binary or categorical feature are absent, although they carry SHAP contributions. The physiology panel therefore lists 18 measurements; the full ranking of all inputs is in the Explanation panel. This is consistent with `docs/ml_interface.md` but narrower than the Track A wording.

## 5. Dataset spellings leak into the UI

- `features.yaml`: `sex.map` is `{Male: 1, Fmale: 0}`. The web app renders every `binary` feature as Yes/No/Not provided regardless of `map`, so "Fmale" is never shown, and the label "Male sex" is answered with Yes (male) or No (female).
- `bbb.map` keys are `N, LBBB, RBBB` and `vhd.map` keys are `N, mild, Moderate, Severe`: shown as given, with the code in brackets (`N (0)`, `mild (1)`), because the config has no longer labels. A `display` label per map entry in `features.yaml` would be clearer.
- `region_rwma` is `categorical` with no `map`: shown as a select of the codes 0 to 4 (from `/meta.features[].allowed`). The config does not say what the codes mean.

## 6. No validation bounds in the config

`features.yaml` `range` is a clinical reference range, `/meta` says "not a slider bound". The form needs bounds for validation and for sliders, so it derives them from `/meta.features[].stats`: values must lie within the training range widened by its own width on each side (never below 0 when the training minimum is not negative), and a value outside the training range itself gets a warning that the estimate extrapolates. Sliders (modifiable numeric features only) span the training min to max. If the team wants clinically motivated hard limits, add `min`/`max` to `features.yaml`.

## 7. Viewer contract: clearing a vessel is not in the agreed interface

The agreed `HeartViewer` interface has no way to clear a vessel back to "no prediction" (`setVessels` takes a `Partial`). The viewer track's implementation does support it: `setVessels({ LAD: undefined })` resets that vessel to neutral. The dashboard relies on that (used on Reset, and for vessels without a result); the placeholder viewer does the same. The interface description should say so, otherwise another viewer implementation could ignore it.

Also: the viewer sources do not compile with `noUncheckedIndexedAccess`, so `web/tsconfig.json` leaves that option off (plain `strict` is on).

## 8. Routes have no `/api` prefix

The backend serves `/health`, `/meta`, `/predict`, `/predict/fast` at its root (`api/main.py`). The web app calls `/api/...` in all environments and `vite.config.ts` strips the prefix in dev and preview. Production hosting must do the same (a reverse proxy rewrite) or set `VITE_API_BASE` to the backend URL and enable CORS for the web origin (`API_CORS_ORIGINS`, default `http://localhost:5173` only).

## 9. Smaller notes

- `README.md` lists "React Three Fiber" in the stack; the web app and the viewer do not need it (the viewer is a framework-free class). The team should align the README with what was built.
- `docs/TEAM_STANDARD.md` calls the middle band "amber"; the config id is `moderate`.
- `ASSETS_AND_LICENSES.md` still has "TBD" in the 3D mesh row (viewer track). The About panel embeds the whole file, so it updates when the row is filled.
- The moderate band for overall CAD is narrow (0.40 to 0.79) because 71% of the development cohort is positive; most illustrative patients land in "high" or "low". Presets were chosen by running them through the real models (case A low, B moderate, C high); they must be re-checked if the models are retrained.
- `npm install` of `vitest` failed with an npm arborist error ("Cannot read properties of null (reading 'edgesOut')") on npm 10.9.4 and was installed with `--legacy-peer-deps`. `npm ci` from the committed lockfile works without flags.
