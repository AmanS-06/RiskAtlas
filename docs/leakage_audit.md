# RiskAtlas: leakage audit

Leakage means information the model would not have at prediction time reaching it during
training or evaluation. On a 303-patient dataset it is the easiest way to get an impressive
number that does not survive scrutiny, so it is guarded in code, not by convention.
**Every team member reviews this file before submission.**

## 1. Target leakage: forbidden inputs

| Column | Why it is forbidden |
|---|---|
| `LAD`, `LCX`, `RCA` | Per-vessel stenosis labels. Each is a target, and using one to predict another would hand the model the angiography result. |
| `Cath` | The angiography outcome that defines `CAD`. |
| `CAD` | The overall target itself. |

This exclusion is required twice over: by the official Track A problem statement, and by the
dataset authors, whose UCI page says only one of `LAD`, `LCX`, `RCA` or `Cath` may be present
for classification.

### Where it is enforced

The forbidden set is built in `pipeline/leakage.py` from `config/manifest.yaml`: the
`forbidden_features` list, plus every target name, plus every target's source column. It is
matched case-insensitively and checked at four points. A violation raises `LeakageError`.

| Point | Code | What is checked |
|---|---|---|
| Feature registry | `leakage.check_registry()` | No active feature in `features.yaml` has a forbidden name or source column |
| Dataset load | `data.load_dataset()` | The input matrix contains no forbidden column |
| Training | `train.train_target()` | The feature list for every target is clean |
| Inference | `RiskAtlas._row()` | A request containing a label column is rejected, so the API cannot be fed one |

## 2. Evaluation leakage: the validation design

The default protocol (`validation.protocol: full_cv`) develops on all patients and estimates
performance by cross-validating the whole procedure. The original locked-holdout design is
kept as `protocol: holdout`; its one result is archived in `reports/archive/split_sample_v1/`.

| Risk | Guard |
|---|---|
| Preprocessing fitted on validation data | Imputers, scalers and encoders live inside an sklearn `Pipeline` and are refit on each training fold |
| Tuning on the same folds that estimate performance | Hyperparameters are tuned in an inner loop, inside the family-selection loop |
| Model selection biasing the reported estimate | `procedure_cv()` reruns the entire procedure (family selection, tuning, calibration, thresholds) inside each outer fold, then predicts that fold's held-out patients. `test_procedure_cv_never_trains_on_its_test_patients` checks that every patient is held out exactly once per repeat |
| Threshold chosen on the patients it is scored on | Thresholds are chosen inside each outer fold and applied to that fold's held-out patients |
| A vessel label leaking into another vessel's model | Vessel models are P(CAD) × P(vessel \| CAD). The CAD label is used only to choose the conditional model's training rows, which is legitimate because both parts are refit inside every fold. No label is ever an input feature |
| Development numbers presented as unbiased | The family-selection out-of-fold figures are labelled optimistic everywhere; the headline comes from the procedure cross-validation |
| Reusing the old holdout quietly | Under `full_cv` there is no holdout: `open_holdout()` refuses. The archived result is reported in full, and `reports/holdout_lock.json` records that the holdout was opened for exactly one model set |
| External model tuned on external data | The reduced model is trained on development data only and applied unchanged |

## 3. Tests that enforce it

| Test | Checks |
|---|---|
| `test_registry_is_clean` | No active feature is forbidden |
| `test_forbidden_names_raise` | Each forbidden name raises, in any letter case |
| `test_registry_with_injected_label_raises` | An injected label column is caught |
| `test_loader_never_returns_labels` | The loaded input matrix holds no label column (needs the dataset) |
| `test_procedure_cv_never_trains_on_its_test_patients` | The outer validation folds never train on their own held-out patients |
| `test_holdout_rows_not_in_dev_split`, `test_get_dev_follows_the_protocol` | The original split stays intact, and each protocol gets the right development data (need the dataset) |
| `test_full_cv_protocol_has_no_holdout_to_open` | The holdout cannot be reopened under the default protocol |
| `test_predict_all_rejects_label_inputs` | Inference rejects a request containing a label (needs trained models) |
| `test_holdout_same_models_can_rerun`, `test_holdout_new_models_blocked_then_recorded` | Lock behaviour under the holdout protocol |
| `test_default_run_never_opens_a_locked_holdout` | Under the holdout protocol, `python -m pipeline` never runs the evaluation |

## 4. Known data quirk

CAD is defined as at least 50% narrowing in any vessel, and the labels agree with that for
almost every patient. The exceptions are counted in [ml_results.md](ml_results.md),
section 1. They are kept as recorded rather than "corrected", because changing labels to
fit a definition is itself a form of leakage from the analyst.

## 5. Reviewer checklist

- [ ] `config/manifest.yaml` lists `LAD`, `LCX`, `RCA`, `Cath` and `CAD` under `forbidden_features`.
- [ ] `python -m pytest` passes on your machine.
- [ ] The 6-page doc reports the cross-validated headline **and** the archived holdout result, and
      says the protocol changed after the holdout was seen.
- [ ] Every number quoted in the README, the 6-page doc and the video appears in `docs/ml_results.md`.
- [ ] Nobody has reported the optimistic family-selection figures as the headline result.
