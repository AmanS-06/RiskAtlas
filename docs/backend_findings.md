# Backend findings

Things found in the ML code, config and docs while building `api/`. Nothing in `pipeline/`, `config/`,
`models/` or `reports/` was changed. Each item has the evidence and a suggested fix for the owner
(Person-1 for `pipeline/` and `features.yaml`). Line numbers refer to the repo at commit `39e78ce`.
Measured on 2026-10-04 in the sandbox the API was built in (4 CPU cores, Python 3.11, the pinned
`requirements.txt`).

| # | Severity | Where | Summary | API handles it? |
|---|---|---|---|---|
| 1 | High | `pipeline/explain.py` | SHAP is not reproducible and not thread-safe | Yes, by locking and reseeding |
| 2 | Low | `pipeline/predict.py` | Point probability can fall outside its own 10-90 percent interval | Documented only |
| 3 | Low | `pipeline/predict.py`, `pipeline/metrics.py` | Docstrings say the opposite of the model structure | n/a |
| 4 | Medium | `pipeline/predict.py` | Inference does not validate values | Yes, API validates from config |
| 5 | Low | `pipeline/predict.py`, `reports/dev_analysis.json` | First prediction is 3x slower than the reported latency | Yes, warm-up |
| 6 | Low | `config/features.yaml` | Labels and codes the frontend cannot use as they are | Documented only |
| 7 | Info | `pipeline/predict.py` | Uncertainty step is 65 percent of full latency | No |
| 8 | Info | repo root | `.env.example`, README and sandbox notes | Partly |

## 1. SHAP explanations are not reproducible and not thread-safe

**Where.** `pipeline/explain.py:24-34` builds `shap.Explainer(..., algorithm="permutation", seed=seed())`
once per target at start-up; `RiskAtlas.predict_all` (`pipeline/predict.py:90-93`) reuses it for every
request. `config/ml.yaml:44` sets `shap_perms: 5`.

**Evidence.**

- shap's permutation explainer only calls `np.random.seed(seed)` once, in its constructor
  (`shap/explainers/_permutation.py:62`). After that every call draws permutations from numpy's
  global RNG, which keeps advancing. So the same input gives a different explanation on every call.
- Same patient, same `RiskAtlas`, two consecutive `predict_all` calls: SHAP contributions differ
  (only `shap` differs; probabilities, uncertainty and counterfactuals are identical). For a random
  patient the largest per-feature difference was 0.041 (CAD) and the top feature changed
  (`tg` vs `ef_tte`). For the illustrative high-risk patient in `reports/example_prediction.json`
  the spread over 5 calls was 0.003 to 0.005 per feature, and the top-5 set changed for RCA
  (`typical_chest_pain` vs `dm` as top feature). Additivity still holds exactly (1.2e-15), so
  `test_predict_all_contract` cannot catch it.
- The masker keeps mutable buffers (`shap/maskers/_tabular.py:90-140`, `_masked_data`, `_last_mask`),
  so one explainer cannot serve two threads. This part rests on reading the code: four concurrent
  `predict_all` calls did differ from serial runs in every target, but that is confounded by the repeat
  non-determinism above, so it is not independent proof.

**Impact.** A dashboard that re-requests `/predict` for the same patient (page reload, view switch,
back to a previous slider value) shows different SHAP bars each time. Two threads corrupt each other.

**What the API does.** Full predictions run under a lock, and numpy's global RNG is reseeded with the
project seed immediately before each one (`api/service.py`, `RealEngine.predict`). With that, the same
request returns identical results (tested: `test_full_prediction_is_deterministic_and_safe_under_concurrency`;
removing the reseed makes it fail). This is a mitigation in the API, not a fix of the cause.

**Suggested fix (in `pipeline/explain.py`).** In `shap_row`, call `np.random.seed(seed())` right before
the explainer is invoked (or build a fresh explainer per call: `explainer_for` takes under 1 ms), so the explanation is a
pure function of the input. Consider raising `shap_perms` above 5 for the served path if the 0.04
spread matters; cost grows linearly (SHAP is about 1 s of the 3.7 s). Document in `ml_interface.md`
that `RiskAtlas` is not thread-safe.

## 2. Point probability can lie outside its own uncertainty interval

**Where.** `pipeline/predict.py:84-88`: `low` and `high` are the 10th and 90th percentile of the
bootstrap refits, while `probability` comes from the model fitted on all patients.
`docs/ml_interface.md` section 3 presents it as "10th-90th percentile interval".

**Evidence.** On 50 randomly chosen real development patients (200 target predictions) the point
probability fell outside `[low, high]` 3 times (1.5 percent, worst gap 0.047). On 60 uniformly random
feature vectors it was 21 of 240 (9 percent), for example LAD p=0.929 with `[0.789, 0.913]`.

**Impact.** A viewer that draws the point inside the band, or asserts `low <= probability <= high`,
will misbehave for a few percent of patients. `width` itself is fine for saturation.

**Suggested fix.** Either document that the point estimate may sit outside the interval, or build the
interval around the point (for example `p +/- ` the bootstrap spread), or include the full-data model in
the bag. The API schema deliberately does not enforce the ordering; `docs/api.md` warns the frontend.

## 3. Docstrings contradict the model structure; `gap` sign is undocumented

**Where.** `pipeline/predict.py:60-61` ("the targets are modelled separately, so P(CAD) can sit below
the riskiest vessel") and `pipeline/metrics.py:110` ("The targets are modelled separately, so this is a
check, not a guarantee").

**Evidence.** `pipeline/models.py:70-83` (`ProductModel`) and `docs/ml_methods.md` section 4 guarantee
P(vessel) <= P(CAD). `docs/ml_interface.md` section 5 says so as well. The docstrings describe the
earlier independent design. Also, `coherence.CAD.gap` is `P(top vessel) - P(CAD)` (negative in the
normal case, for example -0.2008 in the example payload), which no doc states.

**Suggested fix.** Update both docstrings and add the sign convention to `ml_interface.md` section 3.

## 4. `RiskAtlas` accepts illegal values silently, or fails with a raw error

**Where.** `pipeline/predict.py:44` (`float(inputs[n])`) and `_row` generally. Only label keys are
checked.

**Evidence.**

| Input | Result |
|---|---|
| `{"age": 60, "sex": 7}` | A prediction. CAD moves from 0.859 to 0.963 as if sex were an extreme value |
| `{"age": 1e9}` | CAD, LAD, LCX, RCA all exactly 1.0 |
| `{"age": inf}` | `ValueError: Input X contains infinity` from deep inside scikit-learn |
| `{"age": "abc"}` | `ValueError` from `float()` |

**Impact.** Called directly (CV module, SLM tool calls, notebooks), garbage in gives a confident
number out, or an unhandled exception.

**What the API does.** Validates in the request model, generated from `features.yaml`: binary values
must be 0 or 1, mapped categoricals must use their codes, other categoricals must be non-negative
whole numbers, and every number must be finite. Plain numeric features have no upper or lower bound
because the config defines none: `age: 1e9` is accepted by the API.

**Suggested fix.** Add hard plausibility limits (`valid: [min, max]`) per numeric feature in
`features.yaml`, distinct from the clinical reference `range`, and check them in `RiskAtlas._row`;
the API will pick them up from config. Optionally also reject or flag values far outside
`feature_stats` as out-of-distribution.

## 5. First prediction after load is about 3 times slower than the documented latency

**Where.** `pipeline/predict.py:115-123` excludes a warm-up call from the benchmark;
`reports/dev_analysis.json` records `latency_ms_median` full 2581.8, fast 100.8.

**Evidence.** In a fresh process the first `predict_all` took 10.4 s (SHAP 7.4 s), later ones 3.5 to
4.2 s. `python -m pipeline.predict` in this sandbox gives full 3,567 ms and fast 109 ms, against 2,582
and 101 on the author's machine, so the sandbox CPU is about 1.4 times slower for the full path.

**What the API does.** Runs one throw-away `predict_all` at start-up (`API_WARMUP=0` skips it). Start-up
becomes about 15 s.

**Suggested fix.** Mention the cold-start cost in `ml_interface.md` section 4, and call a warm-up inside
`RiskAtlas.__init__` so every consumer benefits.

## 6. Config values the frontend cannot use as they are

- `config/features.yaml:33`: `sex` has `map: {Male: 1, Fmale: 0}`. The keys are the dataset's raw strings
  (`Fmale` is a typo in the source data). `/meta` returns the map unchanged, and so do error messages
  (`must be one of [0, 1] (Male=1, Fmale=0)`). Suggest a separate display label per code, or keep raw
  strings out of `map` for display.
- `config/features.yaml:47`: `bp` is labelled "Blood pressure" with range 90 to 120 mmHg. The data
  (median 130, range 90 to 190) and the range are systolic. Suggest the label "Systolic blood pressure",
  because a diastolic value typed in would be flagged "low".
- `config/features.yaml:83`: `region_rwma` is `categorical` but declares no codes. The valid values 0 to
  4 appear only in `docs/ml_interface.md` and in `models/metadata.json` statistics. The API derives
  `allowed` from the statistics when available (so mock mode without `metadata.json` returns `null`).
  Suggest a `map` or explicit `values` list in the config.
- `anchor` is `null` for every feature (documented as Person-3's to fill in).

## 7. The uncertainty step dominates full-request latency

`pipeline/predict.py:86` runs `predict_pos` once per bag member per target, 80 sequential
single-row `predict_proba` calls through a calibrated pipeline. Measured stages for a full request:
uncertainty about 2.4 s, SHAP about 1.0 s, counterfactual about 0.5 s, total about 3.7 s. Suggest
stacking the 20 bag refits behind one vectorised call, or running members in a thread pool; a 2x gain
here halves the wait after every slider release.

## 8. Notes outside the backend's remit

- `.env.example` documents `API_MOCK`, `API_HOST` and `API_PORT` only. The API reads `API_CORS_ORIGINS`,
  `API_CACHE_FAST`, `API_CACHE_FULL` and `API_WARMUP` as well (all listed in `docs/api.md`). `API_HOST`
  and `API_PORT` are not read by the code; the host and port are uvicorn's `--host` and `--port`.
  The file is outside the allowed edit scope here, so it was left alone.
- `models/metadata.json` records `library_versions`, but `RiskAtlas.__init__` does not compare them
  with the installed ones. The joblib bundles are pickles, so a deployment with different scikit-learn
  or xgboost versions can fail to load or, worse, load and differ. `requirements.txt` pins them,
  so this only matters if the deploy platform ignores the pins.
- Three existing tests that need the dataset (`data/raw/`) skip in this sandbox, because the UCI host is
  unreachable. They were not run here.
