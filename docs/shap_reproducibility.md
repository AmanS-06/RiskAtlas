# SHAP reproducibility

Fix for `docs/backend_findings.md` item 1 ("SHAP explanations are not reproducible and not thread-safe"), made
at the source in `pipeline/explain.py`. Baseline: commit `a93a509`. Everything below was measured on 2026-10-05 in
the sandbox the models were loaded in: Python 3.11.15, numpy 2.4.4, shap 0.51.0, scikit-learn 1.8.0, xgboost 3.2.0,
numba 0.65.1, pandas 3.0.2, 4 shared CPU cores. All four shipped models are the `lr` family.

## 1. Summary

| | Before | After |
|---|---|---|
| Same patient, same process, two calls | different SHAP values (per-feature gap up to 0.025 on real patients) | identical to the last bit |
| Same patient, 4 threads, no lock, no reseed | different from serial and from each other | identical to serial |
| Fresh process vs long-running process | first call equal, every later call history dependent | identical |
| Unrelated `np.random` use, `np.random.seed(...)` elsewhere | changes the explanation | no effect, and the global RNG is no longer touched |
| Needs `api/service.py` lock and reseed | yes | no (recommendation in section 7) |
| Algorithm, `max_evals` formula, permutation count, background, scale | | unchanged, bit-identical to shap 0.51's own explainer for one freshly seeded row |

The fix does not make the explanation more accurate, only repeatable: it is still a 4 to 5 permutation Monte
Carlo estimate (section 8).

## 2. Root cause

shap 0.51.0, `shap/explainers/_permutation.py`:

- line 62, in `PermutationExplainer.__init__`: `np.random.seed(seed)`. The `seed=` argument seeds numpy's
  **process-wide** RNG, once, when the explainer is built.
- line 178, in `explain_row`: `np.random.shuffle(inds)`. Every random permutation of the features is drawn
  from that same global RNG.

So one call advances a global stream, and the next call starts further along it: a different set of permutations,
a different Monte Carlo estimate. The explanation is a function of how many draws anything in the process has made
since the last seed. Two threads interleave their draws on that single stream, so a concurrent result matches
neither the serial one nor each other. Anything else that touches `np.random` (or reseeds it) changes the result too.

Ruled out, by reading the source and by experiment:

- **Fresh process.** Not a source. Call number k after construction is identical in every fresh process (three
  processes, calls 1 to 3: max difference 0.0). The problem is history, not the process.
- **Background sampling.** `explainer_for` passes `max_samples=len(bg)`, so `shap.utils.sample` in
  `maskers/_tabular.py:56` never runs.
- **Reusing one explainer for different rows.** Only through the RNG above.
- **Shared masker buffers** (`maskers/_tabular.py:90-91, 114-115`: `_masked_data`, `_last_mask`). A real hazard on
  paper, because they are mutated on every call and one explainer owned one masker. I could not make it fail:
  with fixed masks (no RNG), 8 threads x 30 evaluations on one shared masker, thread switch interval 1 microsecond,
  0 of 240 evaluations differed from serial. The buffers are reset and used inside one masker call and the numba
  kernel is not compiled with `nogil`, which is probably why CPython 3.11 hides it. The thread problem seen in
  practice is the RNG. The fix removes the hazard anyway (fresh masker per row).

One more fact that matters for reading the numbers: shap's permutation count is `max_evals // (2 * n_varying + 1)`,
where `n_varying` counts the features that differ from the background, not the number of features. With 52 features
and `shap_perms: 5`, `max_evals` is 521. Case C and each of the 50 background patients have 48 varying features (four
features take one constant value across the background): 521 // 97 = 5 permutations. A record with missing values has
all 52 varying (NaN never equals the background), as in cases A and B: 521 // 105 = **4** permutations. This is shap's
behaviour and the fix keeps it exactly.

## 3. Before: reproduction (original `pipeline/explain.py`)

Illustrative case C (`web/src/dashboard/presets.json`), CAD, explainer built like `RiskAtlas.__init__` does:

| Experiment | Result |
|---|---|
| 5 consecutive calls, same explainer, same input | max per-feature difference to call 1: 0.0042, 0.0032, 0.0056, 0.0035. In call 5 the top-5 order changes (`dm` and `age` swap) |
| `np.random.seed(42)` before each call (what the API does) | 3 calls, difference 0.0 |
| `np.random.seed(42)` then one unrelated `np.random.rand()` | 0.0032 |
| `np.random.seed(42)` versus `np.random.seed(7)` | 0.0023 |
| 3 fresh processes, calls 1, 2, 3 | identical across processes (0.0) but call 1 vs call 2 inside a process: 0.0042, call 1 vs call 3: 0.0032 |
| 4 threads, one shared explainer, no lock, no reseed | 0.0049 to 0.0074 against the serial reference; 0.0016 to 0.0025 between threads |

Over the 50 real development patients stored as the bundle backgrounds, two consecutive calls on the same patient:

| Target | Median over patients of the largest per-feature gap | Largest gap | Top-1 feature changed | Top-5 set changed |
|---|---|---|---|---|
| CAD | 0.0051 | 0.0248 | 3 of 50 | 7 of 50 |
| LAD | 0.0038 | 0.0183 | 1 of 50 | 13 of 50 |
| LCX | 0.0026 | 0.0129 | 3 of 50 | 9 of 50 |
| RCA | 0.0027 | 0.0120 | 2 of 50 | 12 of 50 |

I did not reproduce the 0.041 quoted in `backend_findings.md` (it does not say which patients were used); the largest
gap on these 50 real patients is 0.0248. The mechanism and the flipped top feature are confirmed.

To see the root cause on any checkout, with shap alone:

```python
import numpy as np, pandas as pd, shap
from pipeline.predict import RiskAtlas
from pipeline.explain import _fn
ra = RiskAtlas(); b = ra.bundles["CAD"]; names = b["features"]
row = pd.DataFrame([{n: s["median"] for n, s in ra.meta["feature_stats"].items()}], columns=names)
bg = b["background"][names].values
legacy = shap.Explainer(_fn(b["model"], names), shap.maskers.Independent(bg, max_samples=len(bg)),
                        algorithm="permutation", seed=42, feature_names=names)
evals = 2 * len(names) * 5 + 1
a = legacy(row.values, max_evals=evals, silent=True).values[0]
c = legacy(row.values, max_evals=evals, silent=True).values[0]
print(abs(a - c).max())   # 0.0039 for the median patient, not 0 (run from the repo root)
```

## 4. The fix

shap 0.51's explainer offers no way to hand it a private RNG, so it cannot be made safe by configuration.
`pipeline/explain.py` now has `PermutationExplainer`, which runs shap's own loop (copied, about 25 lines) on shap's
own `MaskedModel` and `Independent` masker, with two changes:

1. Each row draws from a fresh `np.random.RandomState(seed)`, never from the global RNG.
2. Each row gets a fresh masker, so nothing mutable is shared. Building or calling an explainer neither reads,
   consumes nor reseeds numpy's global RNG, and the explainer holds only read-only state, so one instance can be shared
   by any number of threads with no lock.

Not changed: the permutation algorithm (antithetic forward and backward passes), `max_evals = 2 * n_features *
shap_perms + 1`, the 50-patient background, the probability-space output, and `base + sum(contributions) ==
probability`. `explainer_for`, `shap_values`, `shap_row`, `global_table`, `waterfall_pngs` and `lime_check` keep
their signatures (`explainer_for` gained an optional `rng_seed`, `shap_values` an optional `independent_rows`).
`pipeline/predict.py` needed no change. `ex(X, max_evals=n)` still returns a `shap.Explanation`.

Rejected alternatives: a module lock with `np.random.get_state()/set_state()` around shap's explainer serialises all
SHAP calls and still breaks if any other thread uses `np.random` meanwhile; reseeding before each call is what the API
does, and it only works when nothing else shares the process.

**Row streams.** By default every row restarts the same stream, so a patient's explanation does not depend on the
batch it is in or its position (`shap_values(X)[i] == shap_row(X[i])`). The same patient therefore has the same bars
in the API, the waterfall PNGs and the LIME check, and a what-if change moves the bars smoothly instead of adding fresh
sampling noise: editing LDL from 160 to 150 in case C changes the other 51 contributions by at most 0.0004 to 0.0008 with
the shared stream, against a median of 0.0018 to 0.0031 (up to 0.005) when each request draws a fresh stream (all four
targets). That sharing is wrong for an average over rows: all rows reuse the same few permutations, so their
sampling errors do not cancel. Measured on the 50 real patients against a 100-permutation reference (6 seeds):

| Target | Error of mean abs SHAP, shared stream (rms) | independent streams | original code (continuing global stream) |
|---|---|---|---|
| CAD | 0.00033 | 0.00017 | 0.00018 |
| LAD | 0.00026 | 0.00013 | 0.00014 |
| LCX | 0.00018 | 0.00009 | 0.00010 |
| RCA | 0.00017 | 0.00009 | 0.00009 |

Per-row error is the same in all three (CAD: 0.0045, 0.0048, 0.0046 mean largest per-feature error). `global_table`
therefore passes `independent_rows=True`: row i gets `RandomState(MT19937(SeedSequence([seed, i])))`, still a pure
function of (seed, i). The shipped scheme measured on CAD: rms 0.00020.

## 5. After: evidence

Checked by running, not by reading:

- **Same algorithm.** New explainer versus shap's own explainer right after `np.random.seed(42)`, 4 targets x cases A, B,
  C (A and B have missing values): bit-identical in 12 of 12, base values included. `tests/test_explain_determinism.py`
  keeps this check, which also fails if a shap upgrade changes the algorithm.
- **Repeated calls, fresh explainers, the cached one, unrelated `np.random` calls, global reseeding:** identical
  (exact `==` on the dicts).
- **Two consecutive calls on the 50 real patients x 4 targets:** largest difference 0.0 (was up to 0.0248).
- **Fresh processes:** a subprocess's result equals the test process's result exactly.
- **Threads:** 8 threads on one shared explainer, mixed rows, a thread hammering `np.random`, switch interval 10
  microseconds: identical to serial. Cold start (the first calls in a fresh process, numba still compiling), 8 threads,
  two fresh processes: 0 of 8 differ from serial, and a digest of all 12 explanations (4 targets x A, B, C) is
  identical across the two processes (`e4e57c5bbbc9e38c`).
- **Against the committed example:** `shap_row` on the `reports/example_prediction.json` input reproduces the committed
  CAD explanation to 2.2e-17 (the same 1 ulp level as the old code replayed here); LAD, LCX, RCA move as in section 6.
- **Whole payload without lock or reseed:** `RiskAtlas.predict_all` (uncertainty, SHAP, counterfactuals): a serial
  repeat and 4 concurrent calls give the same payload (timing excluded).
- **Additivity:** `base + sum(contributions) == probability` to 1e-6 for all 4 targets and 3 records (tested).
- **Cost:** median `shap_row` for case C, old versus new explainer: CAD 200 ms versus 204, LAD 373 versus 374, LCX 336
  versus 366, RCA 359 versus 333. No measurable difference (shared machine, noise is larger than the gaps).
- **API:** `tests/test_api.py` passes unchanged with the lock and reseed still in place.

## 6. Drift against the committed numbers

The old numbers depended on RNG state, so some movement is expected. Method: "before" is the old code run in the order
the API served requests (`np.random.seed(42)`, then CAD, LAD, LCX, RCA drawing from one continuing stream). That replay
reproduces `reports/example_prediction.json` for case C to 3e-17 (4 targets), so it is the committed behaviour.
"After" is the new code.

- **CAD is unchanged**, bit for bit, for cases A, B and C: it was always the first draw after the seed, which is exactly
  what a fresh `RandomState(seed)` gives. The committed CAD explanation, and every doc quoting it, still holds.
- **LAD, LCX, RCA move**, because they used to continue the stream that CAD had consumed. Largest per-feature change:
  case C 0.0020 to 0.0037, case B 0.0043 to 0.0057, case A (missing values, 4 permutations) 0.0138 to 0.0280.
  For comparison, the old scheme's own spread between 20 other seeds, for case C: median largest per-feature gap 0.0022
  to 0.0027 (LAD, LCX, RCA), so the drift is within the old noise.
- **Top-1 driver unchanged in 12 of 12** (case x target). **Sign of every top-5 driver unchanged in 12 of 12.**
- **Top-5 set unchanged in 7 of 12, order unchanged in 6 of 12.** All differences are at rank 5 or a swap of
  neighbours with near-equal values; a 100-permutation (x 2 streams) reference shows rank 5 and rank 6 are nearly tied
  in these cases (case C RCA: 0.0153 versus 0.0152). Agreement of top-5 members with that reference: before 54 of 60,
  after 55 of 60. Neither is more accurate.

Case C (the complete record, the one in the docs), top 5 by absolute value, percentage points:

| Target | Before | After |
|---|---|---|
| CAD | typical chest pain +6.5, dm +4.5, age +4.5, bp +3.0, htn +2.5 | identical |
| LAD | typical chest pain +5.8, age +3.7, ldl +2.6, pr -2.6, dm +2.2 | typical chest pain +5.6, age +4.0, **pr -2.6, ldl +2.5**, dm +2.1 |
| LCX | typical chest pain +3.7, age +3.2, dm +2.8, bp +2.3, htn +1.3 | typical chest pain +3.7, age +3.4, dm +2.7, bp +2.2, htn +1.4 |
| RCA | dm +5.1, typical chest pain +3.9, age +2.7, sex +2.3, **current smoker +1.5** | dm +5.1, typical chest pain +3.5, age +2.9, sex +2.4, **bp +1.5** |

Flagged (not edited, outside this change's scope):

- `docs/submission/DEMO_DATA.md` Case C LAD line: "Typical chest pain +5.8, Age +3.7, LDL cholesterol +2.6, Pulse rate
  -2.6, Diabetes mellitus +2.2, Regional wall motion abnormality (code 0) -1.7" becomes +5.6, +4.0, LDL +2.5, pulse -2.6,
  DM +2.1, regional wall motion -1.9. Base (60.8%) and the sum (+15.4 pp, 76.2%) are unchanged. The order of LDL and
  pulse rate swaps.
- `reports/example_prediction.json` and the web mock keep the old LAD/LCX/RCA numbers until regenerated.

Cases A and B are partial records: top-5 lists for LAD, LCX and RCA changed at rank 5 (A: LAD `vhd` replaced by `tg`,
LCX and RCA `htn` replaced by `tg`; B LCX `htn` replaced by `ef_tte`).

**Global tables (`reports/shap_global_*.csv`).** They come from 100 development rows, and the raw dataset is not in the
sandbox, so `global_table` could not be rerun on the same rows, and nothing under `reports/` was regenerated. As a
proxy I used the 50 real patients stored as each bundle's background. They are the first 50 of the 100 rows
`global_table` samples: `train.py` draws the background with `X.sample(50, random_state=seed)`, `global_table` draws its
rows with `sample(100, random_state=seed)`, and in pandas the smaller sample is a prefix of the larger (checked on a
303-row frame; the first 10 background patients also match the committed `lime_check_*.csv` ids). On those 50 patients,
old code (seed 42) versus new `global_table`:

| Target | Top-10 set | Top-5 set | Largest change in a mean abs SHAP | Rank correlation (52 features) |
|---|---|---|---|---|
| CAD | same | rank 5 differs (`region_rwma` vs `htn`) | 0.00083 | 0.9996 |
| LAD | same | same | 0.00032 | 0.9998 |
| LCX | same | rank 5 differs (`ef_tte` vs `htn`) | 0.00047 | 0.9994 |
| RCA | same | same | 0.00038 | 0.9997 |

Against the committed tables (100 rows, old code): the top-10 set is identical for all 4 targets and the top two
(typical chest pain, age) are identical; ranks 3 to 5 reorder among near-ties, and the same kind of reordering already
separates the committed tables from the old code run on 50 rows (CAD: committed `vhd, region_rwma, ef_tte`, old code on
50 patients `tg, vhd, region_rwma`). To refresh the committed CSVs and the docs' top-5 tables, rerun
`python -m pipeline explain` on the development data; expect the same movement.

## 7. What `api/service.py` can drop (recommendation only, `api/` was not edited)

- **The reseed**, `np.random.seed(seed())` in `RealEngine.predict`: redundant. It also rewrites process-global RNG
  state from a request thread. Safe to remove.
- **The lock `_full_lock` as a correctness device**: no longer needed. The whole payload is identical when 4 requests
  run at once. Do not expect a speed-up from dropping it: 4 full predictions took 23.2 s one after another and 28.3 s on
  4 threads (one measurement, on a loaded machine). If you want to cap concurrent CPU use, replace the
  lock by a `threading.BoundedSemaphore`. `warm_up` takes the same lock.
- **Comments and docs that describe the workaround:** the comment in `RealEngine.__init__` (service.py, "The SHAP
  explainers share a masker ... reseeds that RNG"), `docs/api.md` (the lines on "reseeded per request", "serialised by a
  lock and reseed", "SHAP is not thread-safe"), `docs/backend_findings.md` item 1
  (status), and add to `docs/ml_interface.md` that `RiskAtlas.predict_all` is safe to call from several threads. The test
  `test_full_prediction_is_deterministic_and_safe_under_concurrency` stays valid (it still goes through the lock and
  reseed). The advice to the frontend to keep one `/predict` in flight is still good for latency.
- **Visible side effect:** with or without the reseed, the API's LAD, LCX and RCA SHAP values change slightly relative to
  before this branch (section 6); CAD does not.

## 8. Residual non-determinism and limits

- **Accuracy is unchanged.** The explanation is one fixed 4 or 5 permutation draw. Against a 100-permutation reference,
  the largest per-feature error of a row, averaged over the 50 patients, is 0.0023 (RCA) to 0.0045 (CAD), and rank 5 of
  the top-5 is often a near tie, so its membership is arbitrary. More permutations help (by sampling theory the error
  falls as one over the square root of the permutations; not measured here) and cost grows linearly: the four targets
  take about 1.3 s at 5. Not changed here: `shap_perms` and the `max_evals` formula were to stay.
- **Records with missing values get 4 permutations, complete ones 5** (section 2). This is why cases A and B drift more
  than case C. Using `max_evals = (2 * n_features + 1) * shap_perms` would guarantee `shap_perms`. Not changed here.
- **Bit-identical means within one environment.** Verified on one machine and library build. The committed
  `example_prediction.json` replays to 3e-17, not to the last bit, so expect differences around 1e-16 on a different
  CPU, BLAS or library build; never different permutations.
- **Thread safety of the model itself** was shown for the shipped `lr` models. An `rf` or `xgb` bundle was not tested.
- **sklearn warning under threads.** With several threads predicting at once, sklearn 1.8 (`ColumnTransformer` through
  joblib's sequential path, `sklearn/utils/parallel.py` `_FuncWrapper.__call__`) wraps each call in
  `warnings.catch_warnings()` plus `resetwarnings()` on the process-global filter list. A thread that captures the list
  while another has emptied it emits "`sklearn.utils.parallel.delayed` should be used with ... `Parallel`" as a
  UserWarning, and the global warning filters can end up reset. No numeric effect (results above compared bit for
  bit), not caused by this change; the API's thread pool triggers it today. It is why the thread tests print warnings
  and why a `filterwarnings` mark cannot silence them.
- **Copied algorithm.** `PermutationExplainer` copies about 25 lines of shap 0.51's loop and uses `shap.utils.MaskedModel`,
  which is not part of shap's documented API. `requirements.txt` pins shap, and the bit-for-bit test fails if the
  algorithm changes; review the class when upgrading.
- **No progress bar.** shap's tqdm bar is no longer printed during `shap_values`.
- **First call after a cold start** still pays numba compilation (seconds). It is safe under concurrency (tested);
  the API's warm-up covers the latency.
- `global_table`'s per-row streams depend on the row order produced by `sample(random_state=seed)`, which is itself
  deterministic.

## 9. Tests

`tests/test_explain_determinism.py` (20 tests): the toy-model tests always run (algorithm pinned to shap's, root-cause
canary, row independence, `independent_rows`, edge cases); the real-model tests skip cleanly when `models/` is missing.
They cover repeated calls, fresh and cached explainers, unrelated `np.random` use and global reseeding, an untouched
global RNG, 8 threads with a noisy neighbour, batch equals single rows, additivity for all four targets, the
`predict_all` path, a fresh process, and `global_table` (with `REPORTS_DIR` redirected, so the committed CSVs are never
rewritten). Run: `python -m pytest -q tests/test_explain_determinism.py` (about 65 s on its own including a one-off
numba compile; about 50 s on top of the rest of the suite).

Full suite on this branch: 117 passed, 3 skipped (97 passed, 3 skipped before; the 3 skips are `test_leakage.py` tests
that need the raw dataset). `tests/test_api.py` alone: 61 passed, with the lock and reseed still in `api/service.py`.
