# ML notes (what the models do, and what the UI must respect)

Reviewed 2026-10-05 from `docs/ml_methods.md`, `docs/ml_results.md`, `config/*.yaml`, `models/metadata.json`, `reports/`.

## What it does
- Data: Extension of Z-Alizadeh Sani, 303 patients, 52 inputs (demographics, vitals, symptoms, ECG, labs, echo).
  Referral cohort for angiography, 71% CAD.
- Four calibrated models. **Every deployed model is L2 logistic regression** (chosen by the one-SE rule over lr / rf /
  xgboost / ensemble), wrapped in Platt calibration. Fitted on all 303 patients.
- Structure: `CAD` is direct. Each vessel is `P(vessel) = P(CAD) x P(vessel | CAD)`, so a vessel can never exceed CAD.
- Leakage guard: LAD, LCX, RCA, Cath, CAD are rejected as inputs at load, train and inference (API returns 422).
- Output per target: probability, band (low / moderate / high from per-target cut points), interval from 20 bootstrap
  refits, SHAP in probability space (exactly additive), and a counterfactual.
- Blank inputs are median-imputed and reported back in `input.missing`.
- Validation: repeated nested CV of the whole procedure (5x2), bootstrap 95% CIs. External check of an 8-feature CAD model
  on 920 UCI patients. A first 61-patient holdout was scored once and is kept and disclosed.

## Numbers
| Target | AUC (CV) | Cut points: rule-out / threshold / rule-in |
|---|---|---|
| CAD | 0.92 | 0.40 / 0.72 / 0.79 |
| LAD | 0.84 | 0.31 / 0.43 / 0.73 |
| LCX | 0.72 | 0.20 / 0.40 / 0.56 |
| RCA | 0.73 | 0.24 / 0.37 / 0.54 |

External (reduced model): AUC 0.74 pooled, calibration slope 0.73 (over-confident outside the training population).
Latency on the pipeline machine: fast path about 100 ms, full path about 2.6 s. Cached answers are near instant.

## What the UI has to handle honestly
1. **LCX and RCA are weak.** About half of positive calls are false positives, moderate band is wide. Their colours are
   coarse. Do not render them with the same visual confidence as CAD and LAD.
2. **Subgroup failures.** LCX AUC is 0.56 for patients 65+, RCA 0.66 for 65+. A per-vessel reliability note for older
   patients is a real clinician-facing feature.
3. **Counter-intuitive drivers.** In this cohort valvular heart disease, dyspnea and atypical chest pain *lower* risk.
   That is a referral-pattern artefact (those patients were sent for angiography for other reasons), not protection.
   Panels must say "in this cohort" and never narrate them as protective.
4. **Interval quality varies.** Interval width tracks error well for CAD (Spearman 0.84), weakly for LCX (0.19) and RCA
   (0.25). Uncertainty visuals are fine, but do not oversell them on LCX and RCA.
5. **Counterfactuals often find nothing.** A plausible change exists for only 6% (CAD), 14% (LAD), 34% (LCX), 36% (RCA)
   of high-band patients, because age, sex and clinical findings are fixed. The what-if UI needs a good "risk is driven
   by factors that cannot be changed" state, not an empty box. They are associations, not treatment effects.
6. **Two latencies.** Live sliders use the fast path (about 100 ms: probabilities and bands). Intervals, SHAP and
   counterfactuals arrive from the full path (about 2.6 s). Design a loading choreography for the full result, and keep
   the heart responsive on the fast result.
7. **Per-vessel, not per-lesion.** No lesion localisation. Territory shading is approximate.
8. **Disclaimer wording** must stay: decision support and education only.

## Drivers (top by mean |SHAP|, cohort-level)
CAD: typical chest pain (+), age (+), valvular heart disease (-), regional wall motion abnormality (+), EF (-).
LAD: typical chest pain, age, EF (-), RWMA, pulse rate. LCX: typical chest pain, age, VHD (-), triglycerides, EF (-).
RCA: typical chest pain, age, diabetes, male sex, dyspnea (-).

## Anchors (feature to 3D region, from `config/features.yaml`)
`bp` to `ascending_aorta`. `ef_tte`, `region_rwma`, `q_wave`, `st_elevation`, `st_depression`, `t_inversion`, `lvh`
to `left_ventricle`. Pulse rate (`pr`) has no anchor and will drive the heartbeat rate.
