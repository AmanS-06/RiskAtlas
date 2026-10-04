# RiskAtlas API

FastAPI backend in `api/`. The contract lives in code (`api/schemas.py`); this page is the human
version. Interactive docs are served at `/docs` (Swagger) and the schema at `/openapi.json`.

Every JSON example below is a real response from the running server, trimmed with `...` where a
list or object is long. Nothing is typed by hand except those trims.

> **Clinical safety disclaimer.** RiskAtlas is for decision support and educational purposes only.
> It is not a substitute for formal diagnostic imaging or clinical judgement, and it must not be
> used to make patient care decisions. The same text is returned in `/meta` and in the
> `disclaimer` field of every prediction. The UI must keep it visible.

## 1. Run it

From the repo root, with the dependencies from `requirements.txt` installed:

```bash
uvicorn api.main:app --reload                 # real models, http://127.0.0.1:8000
API_MOCK=1 uvicorn api.main:app --reload      # mock payload, no models needed
python -m pytest tests/test_api.py            # API tests
```

Start-up with the real models takes about 15 s: roughly 2.5 s to load the four models and build
the SHAP explainers, then one throw-away prediction (about 10 s) that warms SHAP up. Without it the
first user would wait about 10 s for a `/predict`. Set `API_WARMUP=0` to skip it (tests do).

The dataset is not needed at inference. The API reads only `config/`, `models/` and
`reports/example_prediction.json` (mock mode only).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `API_MOCK` | off | `1`, `true`, `yes` or `on`: serve the example payload, load no models |
| `API_CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins, or `*`. Add the deployed frontend URL. `http://127.0.0.1:5173` is a different origin from `localhost` |
| `API_CACHE_FAST` | `512` | Entries in the `/predict/fast` LRU cache. `0` disables it |
| `API_CACHE_FULL` | `64` | Entries in the `/predict` LRU cache. `0` disables it |
| `API_WARMUP` | on | `0` skips the start-up warm-up prediction |
| `RISKATLAS_ROOT` | repo root | Read by `pipeline/settings.py`; moves `config/`, `models/` and `reports/` |

For a deployment use one process, `uvicorn api.main:app --host 0.0.0.0 --port $PORT`. Each worker
loads its own copy of the models and its own cache. Allow about 20 s for start-up before the
platform's first health check.

## 2. Endpoints

| Method and path | Purpose | Typical latency |
|---|---|---|
| `GET /health` | Liveness, and whether the models loaded | under 10 ms |
| `GET /meta` | Features, targets, bands, mesh map, model info. Call once at start-up | under 10 ms |
| `POST /predict` | Full payload: probabilities, uncertainty, SHAP, physiology, counterfactuals | about 3.7 s |
| `POST /predict/fast` | Probabilities and bands only, for live sliders | about 0.13 s |

Latencies are measured, see section 7.

### `GET /health`

```json
{
  "status": "ok",
  "mock": false,
  "models_loaded": true,
  "error": null,
  "model": {"created": "2026-10-04 10:11:08", "git_sha": "10eadccccb3a0f44f408890675a2a9e46d17cdd8-dirty"},
  "api_version": "1.0.0"
}
```

`status` is `ok`, `mock` or `degraded`. When the models failed to load the server still starts and
`/health` answers **503** with `status: "degraded"` and the reason in `error`, so a deploy platform
sees an unhealthy instance. `/meta`, `/predict` and `/predict/fast` answer 503 as well (section 5).

### `GET /meta`

Everything the frontend needs, built from `config/features.yaml`, `config/manifest.yaml`,
`config/risk_bands.yaml` and `models/metadata.json`. The frontend hardcodes none of it.

```json
{
  "features": [
    {"name": "age", "label": "Age", "type": "numeric", "unit": "years", "range": null,
     "group": "demographics", "mutable": false, "anchor": null, "map": null, "allowed": null,
     "stats": {"median": 58.0, "std": 10.39227750453444, "min": 30.0, "max": 86.0}},
    {"name": "bbb", "label": "Bundle branch block", "type": "categorical", "unit": null, "range": null,
     "group": "ecg", "mutable": false, "anchor": null, "map": {"N": 0.0, "LBBB": 1.0, "RBBB": 2.0},
     "allowed": [0.0, 1.0, 2.0],
     "stats": {"median": 0.0, "std": 0.37391973517294064, "min": 0.0, "max": 2.0}},
    "... 50 more"
  ],
  "groups": ["demographics", "vitals", "symptoms", "ecg", "labs", "echo"],
  "targets": [
    {"id": "CAD", "label": "Overall CAD", "kind": "overall", "mesh": null, "conditional_on": null,
     "threshold": 0.7214770249660001, "rule_out": 0.40010763598096705, "rule_in": 0.7914672217769247,
     "family": "lr", "prevalence": 0.7128712871287128},
    {"id": "LAD", "label": "Left anterior descending", "kind": "vessel", "mesh": "LAD", "conditional_on": "CAD",
     "threshold": 0.4276426910408791, "rule_out": 0.3069298398610529, "rule_in": 0.7297287336969376,
     "family": "lr", "prevalence": 0.5841584158415841},
    "... LCX, RCA"
  ],
  "risk_bands": [
    {"id": "low", "label": "Low risk", "color": "#2E9E6A"},
    {"id": "moderate", "label": "Moderate risk", "color": "#E0A030"},
    {"id": "high", "label": "High risk", "color": "#D64545"}
  ],
  "uncertainty_interval": [0.1, 0.9],
  "forbidden_inputs": ["LAD", "LCX", "RCA", "Cath", "CAD"],
  "model": {"created": "2026-10-04 10:11:08", "git_sha": "10eadccccb3a0f44f408890675a2a9e46d17cdd8-dirty",
            "protocol": "full_cv", "n_patients": 303},
  "disclaimer": "RiskAtlas is for decision support and educational purposes only. ...",
  "mock": false,
  "api_version": "1.0.0"
}
```

How to use the fields:

- `features`: only features the models use (`use: true`), in model order. Build the form from
  `group`, `label`, `unit`, `type`. `range` is the **clinical reference range** for the physiology
  panel, not a slider bound. For slider bounds and defaults use `stats.min`, `stats.max` and
  `stats.median`. `allowed` lists the legal values of binary and categorical features. `mutable`
  marks what-if candidates. `map` is label to code for text-coded features. Its keys are the raw
  dataset strings (note `Fmale`), so display `label` and your own wording. `anchor` is the mesh a
  SHAP callout pins to (all null today).
- `targets`: `kind: "vessel"` targets have a `mesh` that is the exact `.glb` node name. The
  `kind: "overall"` target (CAD) has none: use it for the heart-level glow. `conditional_on` means
  P(vessel) = P(parent) x P(vessel given parent), so a vessel never exceeds its parent.
  `threshold`, `rule_out`, `rule_in` differ per target, so a legend must use the target's own values.
- `risk_bands`: lowest risk first. Colour comes only from here. Risk is never shown by colour alone:
  always show `label` too.
- `forbidden_inputs`: label columns that must never be sent.

In mock mode `model` is `null` and `mock` is `true`.

### `POST /predict`

Body: a flat JSON object of canonical feature names to numbers (names from `/meta`).

- **Every feature is optional.** An absent key or `null` is imputed by the model and listed in
  `input.missing`; show it as "estimated without ...". `{}` is a valid request.
- Binary features are `0` or `1`. `sex` is `1` for male. Categorical features use their `allowed`
  codes (`bbb`: 0, 1, 2; `region_rwma`: 0 to 4).
- **Unknown keys are accepted and ignored**, and listed in `input.ignored`. Names are case-sensitive:
  `Age` is unknown, `age` is the feature.
- **Label keys are rejected with 422** (`LAD`, `LCX`, `RCA`, `Cath`, `CAD`, in any letter case).
- Wrong types or illegal codes (`sex: 2`, `"age": "abc"`, `inf`) are rejected with 422.

Request (a partial patient, real response below):

```json
{"age": 65, "sex": 1, "bp": 160, "ldl": 160, "fbs": 140, "current_smoker": 1, "typical_chest_pain": 1, "dm": 1}
```

Response (trimmed):

```json
{
  "targets": {
    "CAD": {
      "probability": 0.9631807800440314,
      "band": "high",
      "threshold": 0.7214770249660001,
      "rule_out": 0.40010763598096705,
      "rule_in": 0.7914672217769247,
      "uncertainty": {"std": 0.024255411537913815, "low": 0.9352015308501754, "high": 0.9923643194409006,
                      "width": 0.05716278859072521},
      "shap": {
        "base": 0.7691708147458942,
        "contributions": {"age": 0.04315185371063289, "sex": 0.013368720140859033,
                          "bmi": 0.000553365459552424, "dm": 0.042541287817731366, "...": "48 more"}
      },
      "counterfactual": {"...": "see below"}
    },
    "LAD": {"...": "same fields"}, "LCX": {"...": "same fields"}, "RCA": {"...": "same fields"}
  },
  "coherence": {"CAD": {"top_vessel": "LAD", "gap": -0.18199642185107456, "below_top_vessel": false}},
  "physiology": {
    "bmi": {"label": "Body mass index", "value": null, "unit": "kg/m2", "range": [18.5, 24.9], "status": "missing"},
    "bp": {"label": "Blood pressure", "value": 160.0, "unit": "mmHg", "range": [90.0, 120.0], "status": "high"},
    "...": "16 more"
  },
  "input": {"missing": ["bmi", "htn", "ex_smoker", "fh", "... 40 more"], "ignored": []},
  "model": {"created": "2026-10-04 10:11:08", "git_sha": "10eadccccb3a0f44f408890675a2a9e46d17cdd8-dirty"},
  "timing_ms": {"uncertainty": 2414.7, "shap": 1108.3, "counterfactual": 680.0, "total": 4325.5},
  "disclaimer": "RiskAtlas is for decision support and educational purposes only. ...",
  "mock": false
}
```

The LAD `uncertainty` for the same request is
`{"std": 0.05424200728264496, "low": 0.7204502460869122, "high": 0.8656620680882061, "width": 0.1452118220012939}`.

A real LAD `counterfactual` for the same request:

```json
{
  "goal_probability": 0.7297287336969376,
  "start": 0.7811843581929568,
  "end": 0.7256815258513796,
  "needed": true,
  "achieved": true,
  "changes": [
    {"feature": "ldl", "unit": "mg/dL", "from": 160.0, "to": 100.0},
    {"feature": "current_smoker", "unit": null, "from": 1.0, "to": 0.0}
  ],
  "note": "Model-based what-if. It describes associations in the training data, not proven effects of treatment."
}
```

Field notes (details in [ml_interface.md](ml_interface.md)):

- `probability` is a float from 0 to 1. Round and add `%` only in the UI.
- `band` is a band id from `/meta.risk_bands`.
- `uncertainty.width` drives vessel saturation. `low` and `high` are the 10th and 90th percentile of
  bootstrap refits; the point probability is not guaranteed to lie between them (about 1 to 2 percent
  of predictions on real patients sit slightly outside), so do not assert `low <= probability <= high`.
- `shap.base + sum(contributions) == probability` to within 1e-6. Positive pushes risk up.
- `counterfactual.note` must be displayed. `needed: false` means the target is not in the highest
  band. `achieved: false` means no plausible change set reached the goal. `changes[].from` is sent
  as `from` in JSON.
- `coherence.CAD.gap` is `P(top vessel) - P(CAD)`, so it is normally negative. `below_top_vessel`
  should always be false.
- `physiology` holds only features that have a reference range. `status` is `low`, `normal`, `high`
  or `missing`.
- Identical full requests are answered from a cache (header `X-Cache: HIT`) and return the same
  explanation. Distinct requests are always recomputed, and the SHAP step is reseeded per request so
  the same patient always gets the same explanation.

### `POST /predict/fast`

Same request. Same response shape, but each target holds only `probability`, `band`, `threshold`,
`rule_out`, `rule_in`: no `uncertainty`, `shap` or `counterfactual`. `timing_ms.uncertainty`,
`.shap` and `.counterfactual` are `0.0`. Real response for the request above (LAD only):

```json
{
  "targets": {"LAD": {"probability": 0.7811843581929568, "band": "high", "threshold": 0.4276426910408791,
                       "rule_out": 0.3069298398610529, "rule_in": 0.7297287336969376}, "...": "CAD, LCX, RCA"},
  "timing_ms": {"uncertainty": 0.0, "shap": 0.0, "counterfactual": 0.0, "total": 106.9},
  "coherence": "...", "physiology": "...", "input": "...", "model": "...", "disclaimer": "...", "mock": false
}
```

### Response headers

| Header | Meaning |
|---|---|
| `X-Cache` | `HIT` or `MISS` on `/predict` and `/predict/fast` |
| `X-RiskAtlas-Mock` | `true` on every response in mock mode |
| `Cache-Control: no-store` | On predictions, which carry patient inputs |

## 3. How the frontend should use it

1. **Start-up.** `GET /meta` once. Build the form, sliders, colour legend and mesh map from it.
   Call `GET /health` if you want to show an "API offline" state.
2. **First prediction and Predict button.** `POST /predict` with whatever the user filled in.
   Show a progress state for the SHAP, uncertainty and what-if panels: it takes about 4 s.
3. **While a what-if slider is dragged.** `POST /predict/fast` on every change, about 0.13 s each.
   Recolour vessels and the CAD glow from `targets.<T>.probability` and `band`. **Keep the last
   uncertainty, SHAP and counterfactual on screen** (dim them, label them "from last full update"),
   because the fast response has none.
4. **When the slider is released.** `POST /predict` once, and refresh everything.

Practical rules:

- Keep at most one `/predict/fast` in flight. When the response arrives, send the newest slider value
  if it changed. Tag each request with a counter and drop responses that arrive out of order, or use
  an `AbortController`.
- Keep at most one `/predict` in flight. The server runs full predictions one at a time (SHAP is not
  thread-safe) and cannot cancel a request already running, so a queue of stale full requests costs
  about 4 s each. Wait for the current one and send only the latest.
- Fast requests are served in parallel with a running full request: `/health` stays under 15 ms and
  fast requests slow to about 0.25 s while a full prediction is computing.
- Sending only the changed value is not enough: send the whole patient each time. The API is
  stateless.
- Float noise matters for the cache: a slider that emits `60.00000001` will not hit it. Round to the
  feature's natural precision before sending.
- Always show `input.missing`, the counterfactual `note`, `mock` (see below) and the disclaimer.

## 4. Mock mode

`API_MOCK=1` serves `reports/example_prediction.json` so the frontend can be built without models.

- Every response carries `"mock": true`, `model` is `{"created": "mock", "git_sha": "mock"}`, `/health`
  has `status: "mock"`, and every response has the header `X-RiskAtlas-Mock: true`. Show a visible
  banner when `mock` is true. A mock response must never be shown as a real prediction.
- The probabilities, bands, uncertainty, SHAP and counterfactuals are the **fixed example values** and
  do not depend on the request. `input.missing`, `input.ignored` and `physiology` are computed from
  the request, from config only, so the missing-value and range UI can be built too.
- `/meta` is real config. Cut points and feature statistics come from `models/metadata.json` when it
  exists; without it cut points fall back to the example payload and `stats` is `null`.
- Validation and the leakage guard behave exactly as in real mode.
- `/predict/fast` returns the example without `uncertainty`, `shap` and `counterfactual`.

## 5. Errors

Every non-2xx response has one shape:

```json
{"error": {"code": "leakage", "message": "...", "details": [{"field": "LAD", "message": "..."}]}}
```

`details` is optional. `field` is the request key.

| HTTP | `code` | When |
|---|---|---|
| 422 | `leakage` | A label key (`LAD`, `LCX`, `RCA`, `Cath`, `CAD`) is in the request. Checked before anything else |
| 422 | `validation_error` | Wrong type, non-finite number, illegal code for a binary or categorical feature, or a body that is not a JSON object. One `details` entry per problem |
| 503 | `models_unavailable` | `models/` missing or unreadable |
| 503 | `model_mismatch` | Models were trained against a different `features.yaml`. Retrain with `python -m pipeline train` |
| 404 / 405 | `not_found` / `method_not_allowed` | Unknown path or wrong method |
| 500 | `internal_error` | Unexpected failure. No stack trace in the body; see the server log |

Real examples:

```json
{"error": {"code": "leakage", "message": "Label columns cannot be used as inputs (leakage guard): ['LAD']. Remove them from the request.", "details": [{"field": "LAD", "message": "label columns cannot be inputs"}]}}
```

```json
{"error": {"code": "validation_error", "message": "Invalid request. age: Input should be a valid number, unable to parse string as a number (and 1 more)", "details": [{"field": "age", "message": "Input should be a valid number, unable to parse string as a number", "type": "float_parsing"}, {"field": "sex", "message": "must be one of [0, 1] (Male=1, Fmale=0)", "type": "value_error"}]}}
```

A 500 raised outside the CORS layer carries no CORS headers, so a browser reports it as a network
error rather than showing the body.

## 6. Design notes

- **Config is the source of truth.** The request model is generated from `config/features.yaml`
  (add a feature there and the API accepts it). Targets, meshes, bands, colours and forbidden labels
  come from `config/manifest.yaml` and `config/risk_bands.yaml`. Nothing in `api/` names a feature,
  vessel, colour or threshold. The only literals are the disclaimer (README wording) and the
  `mock` markers.
- **Models load once**, in the app lifespan. A load failure does not stop the server; it answers 503
  with the reason.
- **The event loop is never blocked.** Routes are plain `def`, so FastAPI runs them in its threadpool.
  Full predictions are serialised by a lock and reseed numpy's global RNG first, because the SHAP
  permutation explainer shares mutable state and draws from that RNG. Without this, concurrent
  requests corrupt each other and the same request returns a different explanation each time
  ([backend_findings.md](backend_findings.md), finding 1). Fast predictions need neither.
- **Caches** are in-process LRUs keyed on the feature values (key order and `null` versus absent do not
  matter). A hit returns a deep copy, so callers cannot corrupt it.
- **Logging** never includes request bodies (patient values).

## 7. Measured performance

Measured in this sandbox (4 CPU cores, Python 3.11, uvicorn single process, loopback HTTP, 2026-10-04):

| What | Result |
|---|---|
| `/predict/fast`, 30 distinct patients, client side | median 132 ms, p95 186 ms, max 188 ms (server `timing_ms.total` about 100 to 107 ms) |
| `/predict/fast`, cache hit | about 3 ms |
| `/predict`, 6 distinct patients | median 3,657 ms (range 3,541 to 4,039 ms) |
| `/predict` stages | uncertainty about 2.4 s, SHAP about 0.9 to 1.1 s, counterfactual about 0.4 to 0.7 s |
| `/predict`, cache hit | about 3 ms |
| First full prediction after load, no warm-up | about 10.5 s (this is why the warm-up exists) |
| Start-up, real models, with warm-up | about 15 s |
| While a full `/predict` runs | `/health` max 11 ms; `/predict/fast` median 254 ms |

`pipeline.predict`'s own benchmark on this machine gave full 3,567 ms and fast 109 ms.
`reports/dev_analysis.json` records 2,582 ms and 101 ms from the ML author's machine, so budget for
about 4 s per full prediction on a small CPU. The uncertainty step (20 bootstrap refits per target,
one `predict_proba` call each) is the largest part.
