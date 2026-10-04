# Devpost story: ready to paste

Every number below is from `docs/ml_results.md`, `reports/` or the real API run recorded in `DEMO_DATA.md` (2026-10-04
models, `models/metadata.json` created 2026-10-04 10:11:08). If the models are retrained, regenerate `docs/ml_results.md`
first and update this file. Do not add claims that are not in those files.

Fields marked **[HUMAN]** must be filled by a teammate. Nothing here has been entered on Devpost: AI cannot open Devpost.

---

## 0. Decide the project name first

Devpost currently shows **"BuriBuri Zaemon"** (chosen earlier). The repo, the web app header, the API and the
documentation all say **RiskAtlas**. The video will show "RiskAtlas" in the page header. A judge who sees
"BuriBuri Zaemon" on Devpost and "RiskAtlas" in the video and repo may not connect them.

Recommendation: the team decides on ONE name before recording the video.

- **Option A (recommended): use RiskAtlas.** Change only the Devpost project name (Edit project, Project name) and the YouTube title. Nothing in the repo
  changes. Fewest edits, no code risk.
- **Option B: keep "BuriBuri Zaemon".** Then it must be changed in: README title (`README.md` line 1), the web header
  (`web/src/shared/SiteHeader.tsx`, the `<h1>`), the page `<title>` in `web/index.html`, the API title in `api/`, the
  disclaimer text (`web/src/shared/constants.ts`, `api/schemas.py`), the docs, and the video. That is a code change across several owners' folders, so it
  should be done by the owners and re-tested.
- If the team wants both: use "RiskAtlas" as the project name and put the joke name nowhere official, or use a
  subtitle on Devpost only ("RiskAtlas (team: BuriBuri Zaemon)"). Team names are not required by Devpost.

I could not check whether "RiskAtlas" is already used by another product or project (no web access). Do a quick search
before committing to it.

---

## 1. Project name

```
RiskAtlas
```

**[HUMAN]** Replace if the team picks another name (see section 0).

## 2. Elevator pitch (tagline, 200 characters maximum)

```
Enter clinical, ECG, lab and echo findings and see overall CAD and LAD, LCX, RCA stenosis risk on an interactive 3D heart, with SHAP explanations and what-if changes. Decision support only.
```

Length: **189 characters** (limit 200), counted by script. If you edit it, re-count with:

```bash
python3 -c "import sys; s=sys.stdin.read().rstrip('\n'); print(len(s))" <<< "your text"
```

## 3. Project story ("About the project"): paste into the Devpost description box

Devpost's editor accepts Markdown. Paste everything between the two marker comments `STORY START` and `STORY END`. Headings use `##`.
If the editor does not render Markdown headings, retype them as bold lines.

<!-- STORY START -->

## Inspiration

Track A asks for a system that does more than output a percentage. A risk number does not tell a clinician or a
patient where in the heart the problem is concentrated, or why the model said what it said. We wanted one screen where
the prediction, the anatomy and the explanation sit together and stay consistent with each other.

## What it does

RiskAtlas takes a patient's clinical features and estimates four things: the probability of overall coronary artery
disease (CAD), and the probability of significant stenosis in each of the three main vessels, the LAD, LCX and RCA. The
estimates are shown on an interactive 3D heart whose three coronary arteries change colour with the predicted risk.

- **Feature input.** The form is built from the model configuration: 52 inputs grouped as demographics, vitals,
  symptoms, ECG, labs and echo. Any field can be left blank. The model estimates what is missing and the page lists
  exactly what was estimated ("Estimated without N of 52 inputs"). Three illustrative cases (low, moderate, high
  risk, labelled as not real patients) load in one click.
- **Live 3D map.** While a slider is dragged, a fast prediction path (about 0.1 s) recolours the vessels. On release, a full
  prediction (about 4 s on our test machine) refreshes everything. You can rotate, zoom, pan, and click a vessel to select it
  (or press 1, 2, 3). The selected vessel is outlined, so selection does not depend on colour alone.
  Vessels with a wider uncertainty interval are drawn less saturated. A halo around the heart shows overall CAD risk.
- **Explanation.** For each target, a SHAP breakdown shows how much each input moved the probability from the
  model's base value, and the contributions add up exactly to the displayed probability. A physiology panel lists each
  measurement against its reference range with its share of the effect on the prediction.
- **What-if.** For a high-band result, the app searches for the smallest set of changes to modifiable factors
  (blood pressure, BMI, glucose, lipids, smoking) that brings the estimate below the high-risk cut point, and says
  clearly that it is a model-based association, not a proven effect of treatment.
- **Safety.** A "Not for clinical use" disclaimer banner stays visible at the top of the page. The page also states
  that predictions are per vessel and do not locate a lesion inside a vessel.

## How we built it

- **Data.** The Extension of Z-Alizadeh Sani dataset (UCI, 303 patients, CC BY 4.0). `LAD`, `LCX`, `RCA`, `Cath` and
  `CAD` can never be used as inputs. This leakage guard runs when data is loaded, at training, and at prediction, and is
  covered by tests. A request that contains a label is rejected by the API.
- **Models.** Per target, four families were compared (regularised logistic regression, random forest, XGBoost, and an
  ensemble), all with Platt calibration, and the simplest one within one standard error of the best was chosen. In
  practice logistic regression was chosen for all four targets. The vessel models are conditional on overall CAD:
  P(vessel) = P(CAD) x P(vessel given CAD), so a vessel can never look riskier than overall CAD.
- **Validation.** Performance comes from cross-validating the whole modelling procedure (family selection, tuning,
  calibration and thresholds are all redone inside each fold), with 2,000-sample bootstrap 95% intervals. An
  external check uses a separate UCI heart disease collection with 920 patients.
- **Explanations.** SHAP is computed on the full calibrated model in probability space, so contributions sum to the
  displayed probability. A cross-check against LIME is reported.
- **Backend.** FastAPI with `/meta` (features, targets, bands, mesh map), `/predict` (probabilities, uncertainty, SHAP,
  physiology, what-if) and `/predict/fast`. The web app and the 3D viewer read everything from `/meta`.
- **Frontend and 3D.** React, TypeScript and Vite. The viewer is a three.js class that colours three named meshes
  (`LAD`, `LCX`, `RCA`) of a heart model adapted from Z-Anatomy (CC BY-SA 4.0, based on BodyParts3D). It draws on
  demand, detects software rendering and switches to a lighter model, and has a text fallback when WebGL is not available.
- **One source of truth.** Features, targets, mesh names, risk bands and colours are defined in `config/*.yaml`. Adding a
  feature or a vessel is a config edit and a retrain, not a UI rewrite.

## Challenges we ran into

- **A small dataset.** 303 patients, a locked 61-patient holdout. That holdout
  gave very wide intervals (for example RCA AUC 0.65, 95% interval 0.50 to 0.79), so we switched to cross-validating the whole
  procedure on all patients. That switch was made after we saw the holdout result, so we report both.
- **Avoiding leakage.** On this dataset it is easy to get an impressive number by letting a label slip in. We made the
  guard code, not convention.
- **Vessels that contradict overall CAD.** Independent models put P(CAD) below the riskiest vessel for about a fifth of
  patients, which reads as a contradiction. The conditional structure fixes this by construction.
- **Keeping the 3D view honest.** The data has no lesion location. We colour whole arteries only and say so on screen.
- **Speed without a GPU.** SHAP, uncertainty and what-if take about 4 s, so live sliders use a separate fast path
  of about 0.1 s and keep the last explanation on screen, marked as stale, until the full result arrives.

## Accomplishments that we're proud of

Cross-validated results (repeated cross-validation of the whole procedure on 303 patients, 95% bootstrap intervals):

| Target | ROC-AUC | Brier score |
|---|---|---|
| Overall CAD | 0.92 [0.88, 0.95] | 0.10 [0.08, 0.12] |
| LAD | 0.84 [0.79, 0.88] | 0.16 [0.14, 0.18] |
| LCX | 0.72 [0.66, 0.77] | 0.20 [0.19, 0.22] |
| RCA | 0.73 [0.67, 0.78] | 0.20 [0.18, 0.21] |

For overall CAD, at the cross-validated threshold: accuracy 0.83 [0.79, 0.87], precision 0.93 [0.90, 0.96], sensitivity
0.82 [0.77, 0.86], specificity 0.86 [0.78, 0.92], F1 0.87 [0.84, 0.90]. Accuracy, precision, sensitivity, specificity and F1
for the three vessels are in `docs/ml_results.md` section 3.

- Explanations that add up exactly to the displayed probability, and a consistent link between overall CAD and the vessels.
- Per-prediction uncertainty that is checked: wider intervals go with larger errors on held-out patients for all four targets.
- A viewer that was tested in a real browser with software rendering and no GPU.
- Everything is defined in config, and the validation and reporting are reproducible from `python -m pipeline`.

## What we learned

- At this sample size, honest validation matters more than model choice. A pretrained tabular foundation model (TabPFN
  v2) was tried in an experiment and did not beat the simple models in a meaningful way, which suggests the limit is the
  information in the features.
- Interpretability needs checking, not just plotting: contributions that sum to the output, and a cross-check against
  LIME (top-5 overlap between 0.52 and 0.66 depending on the target).
- A visualization can imply more than the data supports. Putting the limits on screen is part of the design.

## Limitations (read this before trusting any number)

- **LCX and RCA are only moderately predictable:** cross-validated AUC 0.72 and 0.73. Do not read these two vessel colours as precise.
- **Single-centre, angiography-referred cohort of 303 patients.** Prevalence is high (CAD 71%), so this is risk among
  patients like these, not in the general public.
- **External check is reduced.** Only 8 features exist in both datasets. A reduced CAD model scored AUC 0.74 [0.71, 0.77]
  across 920 patients, with per-site AUC 0.72 (Cleveland), 0.74 (Hungary) and 0.66 (VA Long Beach). Switzerland was not scored
  (fewer than 10 patients in one class). Sensitivity there is low (44% pooled), and calibration slope was 0.73,
  meaning predictions were too extreme for that population.
- **Per vessel, not lesion location.** The 3D view colours whole arteries and does not show where in a vessel a
  narrowing is.
- **The 3D model is a normal-anatomy atlas heart,** not the patient's anatomy, and was not reviewed by a clinician.
- **What-if is model-based association,** not a recommendation or a proven effect of treatment.
- **Not a medical device.** For decision support and educational purposes only. It does not replace diagnostic imaging
  or clinical judgement.

## What's next

- Validate on a larger multi-centre dataset that has the same features.
- Add lesion-level or segment-level labels if a dataset provides them, so the 3D view can say more than "this vessel".
- Show the headline metrics inside the app, generated from `reports/`.
- Deploy a hosted demo and test on more browsers and real GPUs (so far only headless Chromium was tested).

## Credits

Dataset: Alizadehsani, R., Roshanzamir, M., & Sani, Z. (2013). extention of Z-Alizadeh sani dataset [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C5461K. Licensed under CC BY 4.0.
External validation data: Janosi, A., Steinbrunn, W., Pfisterer, M., & Detrano, R. (1989). Heart Disease [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X. Licensed under CC BY 4.0.
3D heart model: adapted from Z-Anatomy, "The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on BodyParts3D, (c) The Database Center for Life Science (CC BY-SA 2.1 Japan). Changed by this project: extracted the heart and coronary arteries, split into one named mesh per structure, re-centred, rescaled, new materials. Distributed under CC BY-SA 4.0.

RiskAtlas is a research prototype for decision support and educational purposes only. It is not a medical device, does not provide a diagnosis, and is not a substitute for formal diagnostic imaging or clinical judgement.

<!-- STORY END -->

## 4. "Built with" tags

Type each and press Enter on Devpost. Remove any you cannot defend.

```
python, scikit-learn, xgboost, shap, lime, pandas, numpy, fastapi, uvicorn, pydantic, react, typescript, vite, three.js, webgl
```

Optional extras that are true (used in tests or data): `gltf`, `vitest`, `playwright`.

Do NOT add `react-three-fiber`: the viewer does not use it (the README mentions it, but the code is plain three.js).
Do NOT add anything about OCR, a report reader or a language model: those folders are empty in the repo.

## 5. "Try it out" links

| Link | Value | Status |
|---|---|---|
| Source code (GitHub) | **[HUMAN]** `https://github.com/<owner>/<repo>` | must be public; see SUBMISSION_CHECKLIST.md |
| Live demo | `<URL>` only if the team actually deploys the app | README currently says "Not deployed yet". Leave this link out if there is no deployment; the repo's run instructions are what the rules require |
| Video | **[HUMAN]** the YouTube link (Unlisted) | goes in the Devpost "Video demo link" field |

Do not add a link that has not been opened in a logged-out browser window.

## 6. Other Devpost fields

| Field | What to enter |
|---|---|
| Video demo link | YouTube URL, Unlisted. 3 to 10 minutes. English audio or English subtitles |
| Image gallery | 3 to 5 images. The repo already has screenshots in `web/viewer-demo/screenshots/` (for example `selected_LAD.png`, `bands_all_high.png`, `dark_theme_selected_LCX.png`). Better: take 3 fresh screenshots of the full dashboard from the recording session at 1920x1080, with the real backend running (no MOCK banner). Note the screenshots' provenance: viewer-demo screenshots show only the viewer harness, not the dashboard |
| Thumbnail | A full-dashboard screenshot with the 3D heart and the "High risk" chips visible. 3:2 ratio is what Devpost recommends (not verified here) |
| Team members | Add every teammate by their Devpost account. Real full names. See SUBMISSION_CHECKLIST.md |
| Track / challenge | Track A: Cardiovascular Risk Visualization & Prediction (confirm the exact selector wording on the form) |
| Documentation (max 6 pages) | Track A lists "Project Documentation ... (max. 6 pages)". Whether Devpost has a file-upload field for it is unknown: **[HUMAN]** check the submission form. If there is no field, put the PDF in the repo and link it from the README and from "Try it out" |

## 7. Facts sheet (for answering questions in the Q&A or comments)

| Fact | Value | Source |
|---|---|---|
| Patients | 303 | ml_results.md section 1 |
| Model inputs | 52 (55 defined, 3 dropped) | ml_results.md section 1 |
| Positive rates | CAD 71.3%, LAD 58.4%, LCX 39.3%, RCA 37.6% | ml_results.md section 1 |
| Chosen model family | logistic regression for all four targets (calibrated) | ml_results.md section 2 |
| Validation | repeated 5-fold x 2 cross-validation of the whole procedure, bootstrap 95% CI (2,000 samples) | ml_methods.md section 5 |
| Original 61-patient holdout (superseded, reported in full) | AUC CAD 0.85 [0.74, 0.93], LAD 0.79 [0.66, 0.89], LCX 0.68 [0.53, 0.81], RCA 0.65 [0.50, 0.79] | ml_results.md section 13 |
| Risk bands | low below the 95%-sensitivity point, high from the 90%-specificity point; per target. CAD 40% / 79%, LAD 31% / 73%, LCX 20% / 56%, RCA 24% / 54% | ml_results.md section 4 |
| Latency | full about 4 s, fast about 0.1 s (CPU, no GPU) | docs/api.md section 7; re-measured in DEMO_DATA.md |
| 3D model | 23,283 triangles standard, 6,691 lite | docs/viewer.md section 6 |
| Not built | report reader (OCR), language-model layer, 17-segment bullseye, heartbeat animation, hosted deployment | repo state; do not claim |
