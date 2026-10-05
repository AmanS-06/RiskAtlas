# Demo video script (target about 6:00, limit 3 to 10 minutes)

Official rule (Submission Guidelines): 3 to 10 minutes on YouTube, Unlisted is fine, **Private is not**, must show the
project running and explain the approach, English audio or English subtitles. Track A wants the video to show "the working
system, feature input workflow, 3D visualization interactions, and technical implementation". This script covers all four.

Timing: narration is written at about 150 words per minute. Each segment lists its word count and the time allotted
(speech plus a few seconds for the clicks and the 4 s full-prediction wait). Total narration: 722 words.
All numbers on screen and in the narration were checked against the real backend on 2026-10-04 (`DEMO_DATA.md`).
**If the models are retrained, re-run `scripts/submission/demo_patients.py` and update every number.**

Plan for the recording: one person drives the mouse, one person speaks, or the same person does both after a rehearsal. Record
screen and voice in one pass, in the segment order below, with a short pause between segments so any one of them can be
re-recorded and cut in. Do not read numbers from memory: read them from the lines in this file.

## Timeline at a glance

| # | Time | Segment | Criterion served |
|---|---|---|---|
| 1 | 0:00 to 0:40 | Problem and what RiskAtlas is | Framing for all five criteria; sets up system integration (15%) |
| 2 | 0:40 to 1:20 | Feature input workflow, presets, missing values | Clinical interpretability (20%) and system integration (15%): form built from the API |
| 3 | 1:20 to 2:20 | Live prediction on the 3D heart: rotate, zoom, select, drag | 3D visualization (25%) and system integration (15%): real-time updates |
| 4 | 2:20 to 2:55 | Vessels are predicted separately | 3D visualization (25%): spatial risk mapping per vessel |
| 5 | 2:55 to 3:35 | SHAP explanation and physiology | Clinical interpretability (20%) |
| 6 | 3:35 to 4:10 | What-if counterfactual | Clinical interpretability (20%); system integration (15%) |
| 7 | 4:10 to 4:55 | Honest evaluation and limitations | Predictive performance (30%): metrics, validation methodology; credibility |
| 8 | 4:55 to 5:40 | Architecture and technical implementation | Technical implementation (10%); system integration (15%) |
| 9 | 5:40 to 6:00 | Credits, disclaimer, close | Technical implementation (10%): use of public datasets and anatomical resources |

Criteria coverage: predictive performance (30%) segment 7; 3D visualization (25%) segments 3 and 4; clinical interpretability (20%) segments 5, 6; system integration (15%) segments 2, 3, 8; technical implementation (10%) segments 8, 9.

## Shot list and narration

### Segment 1. Problem and what RiskAtlas is (0:00 to 0:40)

**Criterion:** Framing for all five criteria; sets up system integration (15%)  
**Narration length:** 87 words, about 35 s of speech in 40 s allotted.

**On screen (exact actions):**

1. Browser at `http://localhost:5173/` (real backend running), no prediction yet, **disclaimer banner visible at the top** ("NOT FOR CLINICAL USE ..."), heart in the 3D panel (neutral).
2. Do not touch anything for the first sentence. On "a banner at the top" move the mouse slowly along the banner, then stop.

**Say:**

> Heart disease is a leading cause of death, but one risk percentage doesn't tell a clinician where the problem sits, or why the model said it. This is RiskAtlas, our Track A entry. From clinical, ECG, lab and echo features it estimates overall coronary artery disease and the stenosis risk of the three main vessels, the LAD, the circumflex or LCX, and the right coronary artery or RCA, and draws that on an interactive 3D heart. The banner says it: a research prototype, not a medical device.

### Segment 2. Feature input workflow, presets, missing values (0:40 to 1:20)

**Criterion:** Clinical interpretability (20%) and system integration (15%): form built from the API  
**Narration length:** 83 words, about 33 s of speech in 40 s allotted.

**On screen (exact actions):**

1. Inputs tab is open. Move the mouse over the form so the groups are visible (Demographics, Vitals, Symptoms, ECG, Labs, Echo). Point at the line "x of 52 entered".
2. Point at the heading **Illustrative cases, not real patients**. Click **Illustrative case A**. The vessels on the heart and the four bars turn green. Wait for the status line to say "Full prediction" (about 4 s the first time).
3. Click the summary line **Estimated without 27 of 52 inputs** under the results so it expands, then collapse it.
4. Click **Illustrative case B**. All four turn amber. Hold for two seconds.

**Say:**

> The input form is built from the model's configuration: 52 clinical features in six groups. These three cases are illustrative, not real patients. Case A, a 38-year-old woman with no risk factors, has only 25 of 52 inputs filled, and the page says it estimated without the other 27. That is how missing values are handled. All four targets come out low. Case B, a 60-year-old man with diabetes and hypertension, is moderate: 65 percent for overall CAD, with all three vessels amber.

### Segment 3. Live prediction on the 3D heart: rotate, zoom, select, drag (1:20 to 2:20)

**Criterion:** 3D visualization (25%) and system integration (15%): real-time updates  
**Narration length:** 111 words, about 44 s of speech in 60 s allotted.

**On screen (exact actions):**

1. Click **Illustrative case C**. Wait for "Full prediction". Overall CAD 96%, LAD 76%, LCX 58%, RCA 57%, all red with the label "High risk".
2. Drag on the heart to rotate it about a quarter turn, then scroll the wheel to zoom in on the arteries, then press **Reset view**.
3. Click the heart canvas once, then press **1**, **2**, **3** in turn (LAD, LCX, RCA). The camera turns to each vessel, it gets an outline, and the matching row in the results list is highlighted. Pause on **2** (LCX is on the back of the heart).
4. Press **0** (reset view). Scroll the right column so the **Labs** group shows the **LDL cholesterol** slider (groups collapsed beforehand, see checklist). Press and hold the slider knob at 160 and drag slowly left to about 100 over 8 seconds. The numbers and bars change as you drag, and around LDL 115 the **LAD turns from High to Moderate risk**. The status line says "Live preview from the fast model path ...".
5. Release the mouse. Wait about 4 s: the status line changes to "Full prediction" and the intervals refresh.

**Say:**

> Case C is a 65-year-old smoker with diabetes and typical chest pain. Overall CAD is 96 percent, the LAD 76, the circumflex 58, the right coronary 57, all high. Each artery takes its colour from its own prediction, and every colour carries a text label. I can rotate, zoom, and select a vessel by clicking or pressing one, two or three. Now I drag the LDL slider. While I drag, a fast model path answers in about a tenth of a second, and around an LDL of 115 the LAD drops from high to moderate. When I let go, the full prediction runs, about four seconds here, and refreshes the explanation.

### Segment 4. Vessels are predicted separately (2:20 to 2:55)

**Criterion:** 3D visualization (25%): spatial risk mapping per vessel  
**Narration length:** 65 words, about 26 s of speech in 35 s allotted.

**On screen (exact actions):**

1. Click **Illustrative case C** again to reset the LDL value (all four red).
2. Click the **Labs** title to collapse it. Under **Echo**, click the **Ejection fraction (echo)** box, select the 50, type **35**, press Tab. In **Regional wall motion abnormality** choose **3** from the list.
3. Wait for "Full prediction" (about 4 s). Expected: CAD 99%, LAD 89% High, LCX 59% High, **RCA 53% Moderate (amber)**. Point at the RCA row and its interval "42% to 60%".
4. Press **3** on the heart canvas to show the amber RCA close up.

**Say:**

> Vessels are predicted separately, so they can differ. Lowering the ejection fraction to 35 and setting a wall motion abnormality lifts the LAD to 89 percent, while the right coronary artery slips just under its cut, to 53 percent, and turns amber. That is close to the line, and its interval, 42 to 60 percent, crosses it, so I would not read much into it.

### Segment 5. SHAP explanation and physiology (2:55 to 3:35)

**Criterion:** Clinical interpretability (20%)  
**Narration length:** 79 words, about 32 s of speech in 40 s allotted.

**On screen (exact actions):**

1. Click **Illustrative case C** to reset (so numbers match the script), select **LAD** in the results list (or press 1).
2. Click the **Explanation** tab. The LAD tab is active. Point at the line "Base value 60.8% ... = 76.2%. This adds up to the predicted probability." Then run the cursor down the first five rows (Typical chest pain +5.6 pp, Age +4.0, Pulse rate -2.6, LDL +2.5, Diabetes +2.1).
3. Click the **Physiology** tab, click **Sort by contribution**. Point at LDL cholesterol (160 mg/dL, reference 0 to 100, High) and its share of the effect, then at one normal value.

**Say:**

> The Explanation tab shows why. For the LAD, the model starts from a base value of 60.8 percent and each input moves it. Typical chest pain adds 5.6 points, age 4.0, LDL 2.5, diabetes 2.1, while a normal pulse lowers it by 2.6. The contributions add up exactly to the 76.2 percent shown. These are associations, not causes. The Physiology tab lists each measurement against its reference range, flags what is high, and shows its share of the effect.

### Segment 6. What-if counterfactual (3:35 to 4:10)

**Criterion:** Clinical interpretability (20%); system integration (15%)  
**Narration length:** 73 words, about 29 s of speech in 35 s allotted.

**On screen (exact actions):**

1. Click the **What-if** tab (LAD tab active). Point at "Goal: below 73% (this target's rule-in cut point)" and the change "LDL cholesterol 160 mg/dL to 100 mg/dL", result 76% to 71%.
2. Slowly move the cursor under the line starting **Note:** and hold it there for two seconds (the note must be readable on screen).
3. Click the **CAD** tab inside the What-if panel: "These changes lower the estimate but do not reach the goal: 96% to 91%".

**Say:**

> For a high result, the What-if tab searches for the smallest change to modifiable factors that gets below the high-risk cut. For the LAD, lowering LDL from 160 to 100 takes it from 76 to 71 percent, under the 73 percent cut. The note matters: this is a model-based association, not proof that treatment would do this. For overall CAD the suggested changes reach only about 91 percent, and the page says so.

### Segment 7. Honest evaluation and limitations (4:10 to 4:55)

**Criterion:** Predictive performance (30%): metrics, validation methodology; credibility  
**Narration length:** 92 words, about 37 s of speech in 45 s allotted.

**On screen (exact actions):**

1. Switch to a pre-opened browser tab showing `docs/ml_results.md` section 3 (GitHub render or local Markdown preview) at the table with ROC-AUC and intervals. Zoom so the table is readable. Slowly point at the CAD, LAD, LCX and RCA rows.
2. Scroll to section 13 (the original 61-patient holdout table), then section 12 (external validation, row "External, all sites").
3. Optional, 3 seconds: show `reports/calibration_CAD.png`.

**Say:**

> Now the honest numbers, from cross-validating the whole modelling procedure on all 303 patients, with 95 percent intervals. Overall CAD has an AUC of 0.92, between 0.88 and 0.95. LAD is 0.84. But the circumflex and right coronary artery are only 0.72 and 0.73, so treat those two colours as rough. We first held out 61 patients, saw wide intervals, and changed method after that, so we report both. On 920 outside patients, with eight shared features, the AUC was 0.74. It is one centre, angiography-referred, and per vessel, not per lesion.

### Segment 8. Architecture and technical implementation (4:55 to 5:40)

**Criterion:** Technical implementation (10%); system integration (15%)  
**Narration length:** 88 words, about 35 s of speech in 45 s allotted.

**On screen (exact actions):**

1. Switch to a code editor or the GitHub repo page. Show the folder tree (config, pipeline, api, web, tests, docs). Open `config/features.yaml` for two seconds, then `config/manifest.yaml` (the `conditional_on: CAD` lines and `forbidden_features`).
2. Switch to the API docs at `http://127.0.0.1:8000/docs` (use the port you started) and expand `POST /predict` and `POST /predict/fast`.
3. Switch to a terminal showing the last lines of a fresh `python -m pytest` run and `npm test` (run both before recording, see checklist). Hold on the result lines.

**Say:**

> Technically, config files are the single source of truth for features, vessels, mesh names and risk colours, and the dashboard builds itself from the API, so adding a feature is a config change. A leakage guard keeps the vessel labels and the catheterisation label out of the inputs, at loading, training and prediction, with tests. Vessel models are conditional on overall CAD, so a vessel never looks riskier than CAD. FastAPI serves predictions, the viewer is three.js with a lighter fallback, and the Python and web tests pass.

### Segment 9. Credits, disclaimer, close (5:40 to 6:00)

**Criterion:** Technical implementation (10%): use of public datasets and anatomical resources  
**Narration length:** 44 words, about 18 s of speech in 20 s allotted.

**On screen (exact actions):**

1. Back in the app, click the **About** tab. Scroll to "Data and attribution" so the dataset citation is on screen, then to the ASSETS_AND_LICENSES.md box (expand it).
2. End on the full dashboard with the disclaimer banner visible at the top. Hold for 3 seconds in silence.
3. Optional: a title card made in any editor with the repo URL and the team names.

**Say:**

> The data is the Extension of Z-Alizadeh Sani dataset from UCI, CC BY 4.0. The heart model is adapted from Z-Anatomy, based on BodyParts3D, under CC BY-SA 4.0. RiskAtlas is a research prototype for decision support and education, not a diagnosis. Thanks for watching.

---

## Pre-recording checklist (do all of it, in this order)

Setup that makes the demo reliable:

- [ ] **Use the real backend. The "MOCK DATA - not a real prediction" banner must NOT be visible anywhere in the video.**
      Start from the repo root: `uvicorn api.main:app --port 8000` (no `API_MOCK`). Wait about 15 s until
      `http://127.0.0.1:8000/health` answers `"mock": false, "models_loaded": true`. In a second terminal: `cd web && npm ci && npm run dev`,
      open `http://localhost:5173/` (NOT with `?mock=1`). If the backend is on another port, start the web app with
      `VITE_API_PROXY=http://127.0.0.1:<port> npm run dev`.
- [ ] Check the header: there must be no red/orange "MOCK DATA" chip next to the theme button, and the Predicted risk panel must not show it either.
- [ ] Restart the backend just before the take if you want the first "Full prediction" to show a real time (about 4 s) instead of "0 ms" (the API caches
      identical requests; see `DEMO_DATA.md` section 4).
- [ ] Run the tests once so you can show a fresh result (segment 8): `python -m pytest -q` (last run here: 97 passed, 3 skipped, about 50 s)
      and `cd web && npm test` (last run here: 182 passed). If either fails today, fix it or drop that sentence from the narration. Do not say "tests pass" if they do not.
- [ ] Dry-run the numbers: `python scripts/submission/demo_patients.py` and compare with `DEMO_DATA.md`. If anything differs (the models were
      retrained), update the script text before recording.
- [ ] Pre-open and prepare the evaluation tab for segment 7: `docs/ml_results.md` (GitHub render or editor Markdown preview), scrolled to section 3.

Screen and browser:

- [ ] Screen resolution 1920x1080 (record at 1080p). If the monitor is larger, record a 1920x1080 region, not the whole screen.
- [ ] **Browser zoom 80%** (Ctrl and minus, three times from 100%). At 80% on a 1080p display the heart, all four risk bars and the right-hand tabs fit
      on one screen without scrolling (checked in a 2400x1350 viewport, which is what 80% zoom of 1920x1080 gives). At 100% the LCX and RCA rows are cut off.
- [ ] In the Inputs tab, **collapse the groups Demographics, Vitals, Symptoms and ECG** by clicking their titles (leave Labs and Echo open). The state
      survives loading presets. This keeps the LDL slider and the Echo fields on screen next to the heart. The page is not sticky: if you scroll down to the form, the heart scrolls away.
- [ ] Light theme, "Colour-blind safe palette: off" (the default). Colour-blind palette can be mentioned in the description, not needed in the video.
- [ ] Hide bookmarks bar (Ctrl+Shift+B), close all other tabs except the ones you need, use a clean browser profile or a Guest window (no extensions, no name in the corner).
- [ ] Close notifications and chat apps, turn on Do Not Disturb, quit email and messaging, disable calendar pop-ups, plug in the laptop, close heavy apps (the 3D view and SHAP need the CPU).
- [ ] Clear the terminal and editor of anything private (tokens, personal paths, `.env`). Do not show `.env` files.
- [ ] Mouse: enlarge or highlight the pointer if your recorder allows. Move slowly. Pause on what you point at.
- [ ] If the laptop has a GPU, the viewer will use the standard model with a halo (label bottom-right says the model in use: "Standard model" or "Lite model").
      On software rendering it uses the lite model automatically. Either is fine, but record on the same machine you rehearsed on.

Audio:

- [ ] Use a headset or a USB microphone, not the laptop microphone if the fans are loud. Record a 10-second test, listen with headphones, check for fan noise, clipping and echo.
- [ ] Quiet room, windows closed. Speak slightly slower than normal. Read from this script but do not recite it flat. Leave 1 second of silence at the start and end.
- [ ] English audio. If anyone's accent or audio quality is a concern, subtitles are required anyway (see captions below).

Recorder:

- [ ] Any screen recorder is fine (for example OBS Studio, the built-in screen recording of your OS, or the recorder in your video call app). Settings:
      1920x1080, 30 fps, MP4/H.264, microphone on, system sound off. Do a 20-second test recording and play it back before the real one.
- [ ] Do a full rehearsal with a stopwatch against the timeline. If it runs over about 6:30, cut words from segments 7 and 8 first, never the disclaimer or credits.
      Keep the final video under 10 minutes and over 3 minutes.

## What NOT to say or claim

These are claims the repo does not support or that would break the honesty of the submission.

- Do not say it **diagnoses**, **detects blockages**, **finds lesions**, **locates** a narrowing, or is **clinically validated**, **FDA/CE** anything, or **ready for hospitals**. It is a research prototype for decision support and education.
- Do not say a vessel colour shows **where in the vessel** the problem is. The model is per vessel; the whole artery takes one colour.
- Do not describe the three presets as **patients we tested** or **real cases**. They are illustrative.
- Do not promise **"LAD red, RCA green"** or any pattern the models cannot produce (see `DEMO_DATA.md` section 2). Say "can differ".
- Do not quote the **optimistic** development numbers (the family-selection AUCs) as the result. The headline is the cross-validated table in `docs/ml_results.md` section 3. Always give the interval when you give an AUC.
- Do not call LCX/RCA performance **good**. They are 0.72 and 0.73 AUC. Say "moderate" or "rough".
- Do not say "external validation proves it generalises". Say: reduced eight-feature model, AUC 0.74 on 920 patients from four sites, lower than internal.
- Do not say **"real-time"** without the numbers (fast path about 0.1 s, full about 4 s), and do not say the full explanation is real-time.
- Do not say the what-if is **advice**, **treatment**, or **will lower your risk**. It is a model-based association.
- Do not explain what the **regional wall motion codes 0 to 4** mean. The config does not define them.
- Do not mention or show anything we did not build: **no OCR report reader, no language-model/chat layer, no 17-segment bullseye, no heartbeat animation, no hosted/live deployment** (the folders `cv/` and `slm/` are empty).
- Do not say the 3D model is **patient-specific** or reviewed by a clinician. It is a normal-anatomy atlas heart.
- Do not claim **users, awards, partnerships, hospital input or institutions** that did not happen.
- Do not claim the dataset is **real-world population data**. It is 303 single-centre, angiography-referred patients.
- Do not claim TabPFN **improved** results. It was an experiment, not adopted, not shipped.
- Do not say "multimodal" as if the system reads images. It uses tabular clinical, ECG, lab and echo measurements plus a 3D model.
- Do not show a **MOCK DATA** banner or any API error.

## Captions (English subtitles)

English audio is required or English subtitles. Do both:

1. Record in English audio.
2. Upload to YouTube, open YouTube Studio, Subtitles, choose English, and use the auto-generated captions after processing finishes (can take a few minutes to hours; not verified here).
3. **Proofread every caption line.** Auto-captions get medical and technical words wrong: check "LAD", "LCX", "RCA", "CAD", "SHAP", "Z-Alizadeh Sani", "ROC AUC", "BodyParts3D", "three.js", "FastAPI". Fix them in the caption editor and Publish.
4. Optional but better: upload your own corrected caption file (`.srt`) made from the narration text in this document.
5. Verify captions appear: play the video logged out, turn CC on.

## YouTube upload steps (a human does these)

1. Sign in to YouTube, click Create, Upload video, select the MP4.
2. Title: `RiskAtlas: interactive 3D coronary risk visualization (Track A, Multimodal AI Hackathon 2026)` (use the team's final project name; see `DEVPOST_STORY.md` section 0).
3. Description: paste the block from `docs/submission/ATTRIBUTIONS.md` section 6 and replace the three placeholders (repo URL, Devpost URL, team names). Dataset and 3D model credits must be in it.
4. "Audience": choose **No, it's not made for kids**. Do not tick altered/synthetic content unless it applies (not verified, YouTube's wording changes).
5. **Visibility: select Unlisted. NOT Private.** (Public is also fine.) Click Save/Publish.
6. Copy the link (`https://youtu.be/...`).
7. **Check it plays logged out:** open the link in a private/incognito window, or another browser where you are not signed in. It must play without a prompt to sign in, show the right length (between 3:00 and 10:00), have sound, and show English captions with CC on.
8. Paste the same link into the Devpost "Video demo link" field. Re-open Devpost's project page logged out and click the video to confirm it plays there.
9. Do not edit or delete the video after submitting. If you must replace it, upload a new one, update Devpost, and re-check steps 7 and 8.

## If something goes wrong during the take

| Problem | What to do |
|---|---|
| "Full prediction" is slow or hangs | The backend may be busy or cold. Wait for it (up to 10 s on a first-ever run), cut the wait in editing. If an error banner appears, stop, restart the backend, retake the segment |
| MOCK DATA banner appears | The backend is down or `?mock=1` is set. Stop, fix, retake the whole segment |
| A number differs from the script | Models changed or a field was typed wrong. Reload the preset. If it still differs, trust the screen, edit the script sentence, and re-record that sentence |
| Heart looks pale, vessels hard to see | Scroll to zoom in on the arteries and select the vessel with 1/2/3 (the selected vessel is outlined). Do not rely on the small heart at 80% zoom |
| You mis-speak | Stay silent for 2 seconds, repeat the sentence, cut the mistake in editing |
