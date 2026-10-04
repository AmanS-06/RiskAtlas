# RiskAtlas: ML methods

How the prediction models are built, validated and explained. Results live in
[ml_results.md](ml_results.md), which is generated from `reports/`. This file deliberately
contains no performance numbers, so it never goes stale. Design parameters quoted here come
from `config/ml.yaml`.

## 1. Task and data

Four binary targets from the Extension of Z-Alizadeh Sani dataset (UCI id 411, CC BY 4.0):
overall coronary artery disease (`CAD`, at least 50% narrowing in any major vessel) and
stenosis of each vessel (`LAD`, `LCX`, `RCA`). Inputs are demographic, examination, ECG,
laboratory and echocardiographic features, defined once in `config/features.yaml`. Three
features are defined but unused: weight and height (BMI carries them) and exertional chest
pain (constant in this dataset).

This is a referral cohort for angiography, so disease prevalence is far above a screening
population. The models estimate risk among patients like these, not in the general public.

## 2. Leakage control

`LAD`, `LCX`, `RCA` and `Cath` never enter the model as inputs, and no vessel label is used to
predict another. The guard is enforced in code at load, training and inference time and
covered by tests. Full detail: [leakage_audit.md](leakage_audit.md).

## 3. Preprocessing

Built from the feature registry and always fitted inside a scikit-learn `Pipeline`, so it is
refit on each training fold and never sees validation data:

- numeric: median imputation, then standardisation;
- binary: most-frequent imputation;
- categorical (bundle branch block, regional wall motion): most-frequent imputation, one-hot.

The dataset has no missing cells. The imputers exist for inference, where a clinician may
leave fields blank, and for external validation.

## 4. Models

**Structure.** CAD is defined as at least one stenotic vessel, so the vessel models are built
through it: P(vessel) = P(CAD) × P(vessel | CAD). The conditional part is trained only on
CAD-positive patients. This has two effects. First, a vessel can never look riskier than CAD
itself. Independent models put P(CAD) below the riskiest vessel for about a fifth of patients,
which a clinician would rightly read as contradictory. Second, the vessel models borrow
strength from the CAD model, the strongest of the four. The structure is declared in
`config/manifest.yaml` (`conditional_on`), not hardcoded.

**Families.** Four candidates for each model part, ordered simple to complex: L2-regularised
logistic regression, random forest, gradient boosting (XGBoost, shallow trees, strong
regularisation), and a soft-voting ensemble of the three. Every candidate is wrapped in
Platt-scaling calibration fitted by internal cross-validation. Models are deliberately small,
because 303 patients do not support more.

**Selection.** Per target, repeated stratified cross-validation (5 folds × 3 repeats) with
hyperparameters tuned in an inner 3-fold loop, then the one-SE rule: the simplest family whose
mean AUC is within one standard error of the best. The standard error uses the Nadeau-Bengio
correction, because repeated folds reuse the same patients and a naive error would be too
small.

## 5. Validation design

**Development on all patients, validation by cross-validation of the whole procedure.**
Performance is estimated by repeated outer cross-validation (5 folds × 2 repeats). In every
outer fold the entire procedure (family selection, tuning, calibration and thresholds) is rerun
on the training part only, and the resulting models predict the held-out patients. Because
selection happens inside each fold, the estimate is not biased by it (Varma and Simon, BMC
Bioinformatics 2006). Every metric carries a 2,000-sample bootstrap 95% interval, resampling
patients. The deployed models are the same procedure fitted on all patients.

**Why not a holdout.** The project started with a locked 20% holdout (61 patients), scored once.
That result is kept unchanged in `reports/archive/split_sample_v1/` and reported in
[ml_results.md](ml_results.md). With about two dozen events per vessel, a single small holdout
gives very wide intervals and depends on which patients happen to fall in it. Steyerberg (J
Clin Epidemiol 2018) recommends against random data splitting for validation in small samples,
and notes that reliable assessment needs at least 100 events and 100 non-events. Cross-validating
the whole procedure on all patients uses every patient for both development and validation, and
external validation on an independent cohort (section 11) tests transfer. The protocol was
changed after the holdout result was seen, which is why that result is reported in full rather
than replaced. The original design remains available as `validation.protocol: holdout`.

## 6. Calibration, thresholds and risk bands

Calibration is checked with the Brier score, expected calibration error and reliability plots on
held-out predictions. Each target gets three cut points from its out-of-fold predictions:

- **decision threshold**: maximises Youden's J (sensitivity + specificity - 1);
- **rule-out point**: highest threshold that keeps 95% sensitivity; below it is *low risk*;
- **rule-in point**: lowest threshold that reaches 90% specificity; from it is *high risk*.

Between them is *moderate risk*. Cut points differ by vessel on purpose, because prevalence
differs. In the validation, thresholds are chosen inside each outer fold, so the reported
sensitivity and specificity include the threshold choice. Band names and colours come from
`config/risk_bands.yaml`; cut points are stored in `models/metadata.json` and returned with
every prediction.

## 7. Explanations

SHAP values are computed with the permutation explainer on the **full calibrated model, in
probability space**, against a 50-patient background. Unlike tree SHAP in log-odds, the
contributions sum exactly to the displayed probability, and a test asserts this. For a vessel
this explains the full P(CAD) × P(vessel | CAD) product, so drivers of CAD appear in vessel
explanations as well, which is what the structure means. Each target gets a ranked global table,
per-patient waterfalls, and a cross-check against LIME on ten patients, reported as top-5
feature overlap. Partial disagreement is expected: LIME fits a local linear surrogate, which
handles correlated clinical features differently from exact Shapley values.

## 8. Per-prediction uncertainty

The chosen models are refit on 20 stratified bootstrap samples, with each vessel's conditional
part paired with the CAD model from the same sample. The spread of their predictions gives a
10th-90th percentile interval per patient, which the 3D viewer renders as saturation. Inside the
outer validation folds the same is done with 10 refits, to test on held-out patients whether
wider intervals go with larger errors.

## 9. Counterfactuals

For a patient in the high band, a greedy search looks for the smallest set of changes (at most
three) that moves them below the rule-in point. Only features marked `mutable` may change
(blood pressure, BMI, fasting blood sugar, lipids, smoking); age, sex and clinical findings are
fixed. Numeric features only move toward their reference range, never past it. Candidates are
scored by risk reduction per standard deviation of change, and redundant changes are pruned at
the end. When no plausible change exists, the result says so. These are associations learned
from the data, not proven effects of treatment, and the interface must say that.

## 10. Additional checks

- **Decision curves** (net benefit against treat-all and treat-none) show the threshold range
  where acting on the model would be clinically useful.
- **CAD-vessel consistency**: guaranteed by the structure in section 4, and confirmed on
  held-out predictions.
- **Selection stability**: how often each family is chosen across the outer folds.
- **Subgroups** by sex and age band, to catch large failures.

## 11. External validation

The UCI Heart Disease collection (UCI id 45, CC BY 4.0) holds 920 patients from four sites:
Cleveland, Hungary, Switzerland and VA Long Beach. Only eight features exist in both datasets,
so a separate reduced-feature logistic regression is trained on the development data and
applied unchanged. Missing values there are filled with development-set medians. Performance is
reported pooled and per site, with a calibration slope and intercept. Sites with fewer than 10
patients in either class get no AUC. The drop from internal performance is expected, given fewer
features, different populations and different prevalence.

## 12. Model experiments

Before the final design was fixed, alternatives were compared on the original 242-patient
development set, all on identical folds (`experiments/model_comparison.py`): direct versus
hierarchical vessel models, and TabPFN v2, a pretrained foundation model for small tabular data
(Hollmann et al., Nature 2025). TabPFN was not adopted: its gains were within noise, it was worse
on RCA, and at several seconds per prediction on a CPU it would break real-time interaction in
the 3D viewer. That a state-of-the-art model barely changes the result suggests the ceiling is
the information in the features, not the choice of model.

## 13. Reproducibility

- `python -m pipeline` rebuilds everything: audit, training with procedure cross-validation,
  evaluation, explanations, external validation, analyses, counterfactuals and the results report.
- Seed 42 everywhere. Training is deterministic: rerunning it reproduces the same models.
- Python 3.11 with pinned dependencies in `requirements.txt`.
- `models/metadata.json` records feature order, library versions, data hash, validation protocol
  and the git commit (with a `-dirty` suffix if there were uncommitted changes). The inference
  layer refuses to load models whose feature order does not match `features.yaml`.

## 14. Limitations

- **Small sample.** 303 patients. Intervals are wide and small differences between models are
  not meaningful.
- **Single-centre referral cohort.** Results may not transfer to other populations; external
  validation tests this with a reduced feature set only.
- **No lesion localisation.** Predictions are per vessel. Regional wall motion abnormality is a
  clinical feature, not a 3D lesion coordinate.
- **Protocol change after a first look.** Disclosed in section 5; both results are reported.
- **Counterfactuals are not causal.**
- **Decision support only.** Not a substitute for angiography or clinical judgement.
