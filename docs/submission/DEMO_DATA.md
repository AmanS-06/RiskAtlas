# Demo data: illustrative patients and what the real models return

**All patients here are illustrative, not real people.** The app labels its three presets "Illustrative cases, not real
patients" and the video must say the same.

How this was produced (2026-10-04): the FastAPI backend was started from this worktree with the repo's real models
(`models/metadata.json` created 2026-10-04 10:11:08, git `10eadccccb...-dirty`, protocol `full_cv`, 303 patients), using
a fresh venv built from `requirements.txt` (`uvicorn api.main:app --port 8031`, no `API_MOCK`). Every number below is a
real `/predict` response from that server (script: `scripts/submission/demo_patients.py`). The three app presets were
then also driven through the real web app in headless Chromium against that backend, and the on-screen numbers matched.
**If the models are retrained, every number here and in `DEMO_SCRIPT.md` must be regenerated** (command at the bottom).

## 1. The three built-in presets already do the job: reuse them

The web app ships three presets (`web/src/dashboard/presets.json`, buttons "Illustrative case A / B / C"). They were
chosen by the web author by running them through the real models, and they still give low / moderate / high with
these models. No need to type anything. Use them in the video.

Bands: Low below the rule-out point, High from the rule-in point, Moderate between. Each target has its own cut points.

| Target | Low below | High from | Decision threshold |
|---|---|---|---|
| Overall CAD | 40.0% | 79.1% | 72.1% |
| LAD | 30.7% | 73.0% | 42.8% |
| LCX | 19.7% | 55.6% | 39.9% |
| RCA | 23.6% | 54.5% | 37.3% |

### Case A: low risk (button "Illustrative case A")

38-year-old woman, no cardiovascular risk factors, normal labs, non-anginal chest pain, EF 60%. **Partial record:** 25 of 52
inputs entered, the page says "Estimated without 27 of 52 inputs" (good moment to show the missing-value behaviour).

| Target | Probability | Band | 10th to 90th percentile interval |
|---|---|---|---|
| CAD | 4.1% (shown as 4%) | Low | 2% to 14% |
| LAD | 2.5% (3%) | Low | 2% to 10% |
| LCX | 2.0% (2%) | Low | 1% to 7% |
| RCA | 1.9% (2%) | Low | 1% to 6% |

Top drivers (CAD, percentage points): Age -20.8, Typical chest pain (absent) -12.6, Ejection fraction -9.1, Non-anginal chest pain -8.6, Triglycerides -5.7.
All four vessels green, calm heart. Full prediction cold: about 4.0 s.

### Case B: moderate risk (button "Illustrative case B")

60-year-old man with diabetes and hypertension, atypical chest pain, family history, ex-smoker. **Partial record:** 25 of 52 entered.

| Target | Probability | Band | Interval |
|---|---|---|---|
| CAD | 65.1% (65%) | Moderate | 57% to 82% |
| LAD | 44.5% (45%) | Moderate | 40% to 61% |
| LCX | 37.0% (37%) | Moderate | 32% to 46% |
| RCA | 38.1% (38%) | Moderate | 29% to 53% |

Top drivers (CAD): Typical chest pain (absent) -13.1, Family history of CAD +11.0, Diabetes mellitus +8.7, Dyspnea -5.7, Atypical chest pain -4.8.
All four amber. Physiology panel flags BMI, blood pressure, fasting blood sugar and LDL as high.
Note: this is a good case to show that the model is not just "more risk factors = red": the missing typical chest pain pulls CAD down.
No what-if is needed here ("already below the goal" because no target is in the high band).

### Case C: high risk (button "Illustrative case C")

65-year-old male smoker with diabetes, hypertension, obesity and typical chest pain. **Complete record:** 52 of 52 entered
(no "estimated without" note). BP 160 mmHg, LDL 160 mg/dL, fasting glucose 140 mg/dL, HDL 39 mg/dL, EF 50%.

| Target | Probability | Band | Interval |
|---|---|---|---|
| CAD | 96.3% (96%) | High | 94% to 99% |
| LAD | 76.2% (76%) | High | 71% to 84% |
| LCX | 57.9% (58%) | High | 55% to 69% |
| RCA | 57.2% (57%) | High | 53% to 71% |

SHAP, LAD (percentage points, base 60.8%): Typical chest pain +5.6, Age +4.0, Pulse rate -2.6, LDL cholesterol +2.5,
Diabetes mellitus +2.1, Regional wall motion abnormality (code 0) -1.8. "Base 60.8% + contributions 15.4 pp = 76.2%": the page shows this
addition and says it adds up.
Physiology panel (sorted by contribution, LAD): LDL 160 mg/dL (reference 0 to 100) High, 7.0% of total effect; pulse rate 70 bpm
normal, 7.4%, lowers risk; fasting blood sugar 140 High; blood pressure 160 High.

What-if, as shown by the app (real server output):

| Target | Suggested change | Result | Reaches the goal? |
|---|---|---|---|
| LAD | LDL 160 to 100 mg/dL | 76.2% to 71.5% (goal: below 73%) | yes |
| LCX | Blood pressure 160 to 120 mmHg | 57.9% to 55.4% (goal: below 55.6%) | yes |
| RCA | Stop smoking, blood pressure 160 to 120 | 57.2% to 53.9% (goal: below 54.5%) | yes |
| CAD | Blood pressure 160 to 120, fasting glucose 140 to 100, stop smoking | 96.3% to 91.2% (goal: below 79.1%) | **no** |

The shifts are a few percentage points. Say so. Note that the app's note text is "Model-based what-if. It describes
associations in the training data, not proven effects of treatment."

## 2. The vessels differ: edit Case C in two fields

Honest finding first: I searched for a patient with **LAD high and RCA low** (900 random plausible profiles and a
hill-climb that pushed RCA down while keeping LAD high). **The models cannot produce it.** When overall CAD is high, the
lowest RCA reached was about 34% (moderate), and only with a contrived combination (EF 25 to 30, bundle branch block, edema,
ST elevation, several more). The conditional structure P(vessel) = P(CAD) x P(vessel given CAD) means a green vessel needs a
low overall CAD. The realistic contrast is **LAD red, the others amber**. Do not promise "one vessel green, another red".

### Case C edited (recommended for the video): Ejection fraction 50 to 35 and Regional wall motion abnormality 0 to 3

Start from Case C, type `35` in "Ejection fraction (echo)" and choose `3` in "Regional wall motion abnormality" (the form shows codes 0 to 4, the
config gives no meaning for them, so do not explain the codes). Verified in the real app in the browser.

| Target | Probability | Band | Interval |
|---|---|---|---|
| CAD | 99.2% (99%) | High | 98% to 100% |
| LAD | 89.1% (89%) | High | 78% to 92% |
| LCX | 59.3% (59%) | High | 56% to 71% |
| RCA | 53.1% (53%) | **Moderate** | 42% to 60% |

LAD rises 76% to 89% and RCA drops from High to Moderate: one vessel changes colour. **RCA is only 1.4 points under its High cut
(54.5%),** and its interval (42% to 60%) crosses the cut, so describe it as "just under the high-risk cut", not as a clear difference.

### Optional Case D (a cleaner LAD-dominant pattern, partial record)

55-year-old woman, hypertension, family history, typical chest pain, dyspnea, EF 35, regional wall motion abnormality 3, ST depression and T-wave inversion.
Values (all others blank; the page says "Estimated without 27 of 52 inputs"):

```json
{"age": 55, "sex": 0, "bmi": 26, "dm": 0, "htn": 1, "current_smoker": 0, "ex_smoker": 0, "fh": 1, "dlp": 0,
 "bp": 140, "pr": 80, "typical_chest_pain": 1, "atypical": 0, "nonanginal": 0, "dyspnea": 1,
 "st_depression": 1, "t_inversion": 1, "fbs": 95, "tg": 150, "ldl": 140, "hdl": 45, "hb": 13.5,
 "ef_tte": 35, "region_rwma": 3, "vhd": 0}
```

| Target | Probability | Band | Interval |
|---|---|---|---|
| CAD | 99.2% | High | 97% to 100% |
| LAD | 90.8% | High | 79% to 92% |
| LCX | 52.7% | Moderate | 46% to 58% |
| RCA | 39.5% | Moderate | 23% to 41% |

This is **not** a button in the app: it would have to be typed field by field (about 25 values), which is slow on camera. The same JSON
is in `scripts/submission/extra_patients.json`. If the team wants it as a fourth button, someone with ownership of
`web/src/dashboard/presets.json` can add it (outside this task's scope). The video does not need it.

## 3. Live-drag behaviour (fast path), measured in the real app

With Case C loaded, drag the "LDL cholesterol" slider (training range 18 to 232 mg/dL; grab it at 160 and move left). Fast
predictions (about 0.1 s each) update the numbers and bars while dragging. Values from the real UI, mouse drag, other fields unchanged:

| LDL | CAD | LAD | LCX | RCA |
|---|---|---|---|---|
| 160 (start) | 96% high | 76% high | 58% high | 57% high |
| 140 | 97% high | 75% high | 57% high | 57% high |
| 120 | 97% high | 73% high | 57% high | 57% high |
| 109 | 97% high | **72% moderate** | 57% high | 57% high |
| 99 | 97% high | 71% moderate | 56% high | 57% high |

The LAD band flips from High to Moderate at about LDL 116 (alone, other values unchanged). Effects are small because the model leans mostly on symptoms and
age: one slider moves a vessel by a couple of points, and only crosses a colour boundary where a vessel already sits near a cut. In the
real UI, while dragging, the status line reads "Live preview from the fast model path. Intervals, explanation and what-if refresh when you
release the control."; after release the full prediction took 4.7 s in the browser and the explanation refreshed.
Blood pressure 160 to 120 does the same for LCX (flips at about 122 mmHg).

## 4. Timing to expect

| What | Measured here |
|---|---|
| Full prediction, cold (not cached) | about 3.8 to 4.1 s server time; 4.7 s as seen in the browser after a slider release |
| Fast prediction | about 0.1 s |
| Repeat of an identical request | answered from cache in a few milliseconds; the status line then says "Full prediction in 0 ms" or "1 ms". This is real (cache), but looks odd on camera. For the first appearance of a preset restart the backend (cold cache) or accept that the second view is instant |
| Backend start-up | about 15 s (warm-up included). Wait for `/health` to answer before recording |

## 5. Reproduce or refresh

```bash
cd <repo root>
python -m venv /home/user/work/venv_sub && /home/user/work/venv_sub/bin/pip install -r requirements.txt   # or your own venv
/home/user/work/venv_sub/bin/uvicorn api.main:app --port 8031 &       # real models, NOT API_MOCK
python scripts/submission/demo_patients.py                                 # the three presets
python scripts/submission/demo_patients.py --extra scripts/submission/extra_patients.json --json /tmp/out.json
```

The script refuses to run against a mock-mode API. Pass `--api http://127.0.0.1:8000` if your server is on another port.
The app's dev proxy points at port 8000 by default; to use another backend port start the web app with
`VITE_API_PROXY=http://127.0.0.1:8031 npm run dev`.
