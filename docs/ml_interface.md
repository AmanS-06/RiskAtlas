# RiskAtlas: ML interface for the backend and frontend

For Person-2 (API, dashboard) and Person-3 (3D viewer). Everything the ML side exposes, and
how the scene and dashboard should use it.

## 1. Loading

```python
from pipeline.predict import RiskAtlas

ra = RiskAtlas()                 # once, at API startup: loads four models and builds explainers
out = ra.predict_all(inputs)     # full payload, for /predict
fast = ra.predict_fast(inputs)   # probabilities and bands only, for live sliders
```

Load once and reuse it; loading per request is slow. If startup raises `ModelMismatch`, the
models were trained against a different `features.yaml`. Retrain with `python -m pipeline train`.

## 2. Input

A flat dict of **canonical feature names** (from `config/features.yaml`) to numbers.

- Binary features are `0`/`1`. `sex` is `1` for male.
- Categorical features use the codes in their `map` (`bbb`: N=0, LBBB=1, RBBB=2). `region_rwma` is 0-4.
- Missing or `None` values are allowed. They are imputed and listed in `input.missing`, which the
  dashboard should show ("estimated without: ...").
- Unknown keys are ignored and listed in `input.ignored`.
- A key that is a label (`LAD`, `LCX`, `RCA`, `Cath`, `CAD`) raises `LeakageError`. Return HTTP 422.

## 3. Output

`reports/example_prediction.json` is a real response for an illustrative high-risk patient.
**Use it as the `API_MOCK=1` payload**, so the frontend is built against the true shape.

| Path | Type | Meaning |
|---|---|---|
| `targets.<T>.probability` | float 0-1 | Calibrated probability. Format as a percentage only in the UI |
| `targets.<T>.band` | `low` / `moderate` / `high` | Band id from `config/risk_bands.yaml`; take colour and label from there |
| `targets.<T>.threshold`, `rule_out`, `rule_in` | float | This target's cut points. **They differ by vessel**, so a legend must use the target's own values |
| `targets.<T>.uncertainty` | `{std, low, high, width}` | 10th-90th percentile interval. Drive vessel saturation from `width`: narrow means crisp, wide means desaturated |
| `targets.<T>.shap` | `{base, contributions: {feature: value}}` | `base + sum(contributions) == probability` exactly. Positive values push risk up |
| `targets.<T>.counterfactual` | object | `needed`, `achieved`, `changes: [{feature, unit, from, to}]`, and `note`, **which must be displayed** |
| `coherence.CAD` | `{top_vessel, gap, below_top_vessel}` | See section 5 |
| `physiology.<feature>` | `{label, value, unit, range, status}` | `status` is `low` / `normal` / `high` / `missing`, for the physiology panel |
| `input` | `{missing, ignored}` | See section 2 |
| `model` | `{created, git_sha}` | Show in an "about" panel |
| `timing_ms` | object | Per-stage latency |

`predict_fast` returns the same shape with `uncertainty`, `shap` and `counterfactual` omitted.

## 4. Latency: sliders

The full payload takes a couple of seconds, mostly the uncertainty refits and SHAP. The fast
path takes around a tenth of a second. Measured values: `reports/dev_analysis.json`,
`latency_ms_median`.

- While a what-if slider is **dragged**: call `predict_fast`, recolour vessels, keep the last uncertainty and SHAP on screen.
- When it is **released**: call `predict_all` and refresh everything.

## 5. Coherence: vessels never exceed CAD

Each vessel is modelled as P(CAD) × P(vessel | CAD), so a vessel's probability can never exceed
CAD's. The dashboard can rely on this ordering. `coherence.CAD` is still returned (top vessel and
gap) as a safety check, and `below_top_vessel` should always be false. If it is ever true, the
models were trained with a manifest that drops `conditional_on`; show a short note rather than
hiding it.

For the 3D scene, this means the overall glow (CAD) is always at least as strong as any vessel's
colour.

## 6. Mapping to the 3D scene

- `config/manifest.yaml`: each target's `mesh` is the exact `.glb` node name (`LAD`, `LCX`,
  `RCA`). `CAD` has no mesh: use it for the overall glow or heart-level state.
- `config/features.yaml` `anchor`: the mesh a feature's SHAP callout is pinned to. Currently
  empty for all features; Person-3 fills these in, using node names from the `.glb`.
- Do not claim lesion location within a vessel. Predictions are per vessel.

## 7. Serving metadata through /meta

`/meta` can serve these files directly, so the frontend hardcodes nothing:

- `config/features.yaml`: names, labels, units, reference ranges, groups, anchors;
- `config/risk_bands.yaml`: band ids, labels, colours;
- `config/manifest.yaml`: targets, labels, meshes;
- `models/metadata.json` targets: per-target cut points and model family.
