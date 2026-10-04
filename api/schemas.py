"""The API contract: pydantic v2 request and response models.

Mirrors docs/ml_interface.md and reports/example_prediction.json. Nothing here names a feature,
a target or a band: the request model is generated from config/features.yaml, and targets,
bands and groups are plain strings and dicts whose values come from config/ and models/.
"""
import json
from typing import Annotated, Any, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, create_model, model_validator

from pipeline import features, leakage
from pipeline.settings import REPORTS_DIR

API_VERSION = "1.0.0"

# Wording from README.md. Returned by /meta and with every prediction.
DISCLAIMER = ("RiskAtlas is for decision support and educational purposes only. It is not a substitute "
              "for formal diagnostic imaging or clinical judgement, and it must not be used to make "
              "patient care decisions.")


# ---------------------------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------------------------

class InputLeakage(leakage.LeakageError):
    """A request carried a label column (LAD, LCX, RCA, Cath, CAD). Maps to HTTP 422."""

    def __init__(self, keys):
        self.keys = sorted(str(k) for k in keys)
        super().__init__(f"Label columns cannot be used as inputs (leakage guard): {self.keys}. "
                         "Remove them from the request.")


class _Inputs(BaseModel):
    """Flat dict of canonical feature names to numbers. Every feature is optional (missing or null
    is imputed and reported in input.missing). Unknown keys are accepted and reported in
    input.ignored. Label keys are rejected."""
    model_config = ConfigDict(extra="allow")
    __pydantic_extra__: dict[str, Any] = Field(init=False)

    @model_validator(mode="before")
    @classmethod
    def _no_labels(cls, data):
        if isinstance(data, dict):
            bad = [k for k in data if str(k).lower() in leakage.forbidden()]
            if bad:
                raise InputLeakage(bad)
        return data


def _allowed_check(spec: dict):
    """Value check derived from the feature's type and map in features.yaml (None passes: missing)."""
    kind, mapping = spec["type"], spec["map"]
    if mapping:
        allowed = sorted({float(v) for v in mapping.values()})
        hint = ", ".join(f"{k}={v}" for k, v in mapping.items())
    elif kind == "binary":
        allowed, hint = [0.0, 1.0], "0 or 1"
    else:
        allowed, hint = None, None

    def check(v):
        if v is None:
            return v
        if allowed is not None and v not in allowed:
            raise ValueError(f"must be one of {[int(a) for a in allowed]} ({hint})")
        if kind == "categorical" and not mapping and (v < 0 or v != int(v)):
            raise ValueError("must be a non-negative whole number (category code)")
        return v
    return check


def _describe(spec: dict) -> str:
    text = spec["label"] + (f" ({spec['unit']})" if spec["unit"] else "")
    if spec["range"]:
        text += f". Reference range {spec['range'][0]} to {spec['range'][1]}"
    if spec["map"]:
        text += ". Codes: " + ", ".join(f"{k}={v}" for k, v in spec["map"].items())
    elif spec["type"] == "binary":
        text += ". 0 or 1"
    return text


def _example_inputs() -> dict:
    try:
        return json.loads((REPORTS_DIR / "example_prediction.json").read_text(encoding="utf-8"))["input"]
    except (OSError, KeyError, ValueError):
        return {}


def build_request_model():
    fields = {}
    for spec in features.active():
        kind = Annotated[Optional[float], AfterValidator(_allowed_check(spec))]
        fields[spec["name"]] = (kind, Field(None, allow_inf_nan=False, description=_describe(spec)))
    example = _example_inputs()

    class _Documented(_Inputs):
        model_config = ConfigDict(extra="allow", json_schema_extra={"examples": [example]} if example else None)

    return create_model("PredictRequest", __base__=_Documented, __doc__=_Inputs.__doc__, **fields)


PredictRequest = build_request_model()


# ---------------------------------------------------------------------------------------------
# Response: /predict and /predict/fast
# ---------------------------------------------------------------------------------------------

class _Out(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class Uncertainty(_Out):
    std: float
    low: float = Field(description="10th percentile of the bootstrap refits. The point probability can sit outside [low, high].")
    high: float = Field(description="90th percentile of the bootstrap refits")
    width: float = Field(description="high - low. Drive vessel saturation from this: narrow is crisp, wide is desaturated")


class Shap(_Out):
    base: float
    contributions: dict[str, float] = Field(description="feature -> contribution; base + sum(contributions) == probability")


class CounterfactualChange(_Out):
    feature: str
    unit: Optional[str]
    from_: float = Field(alias="from")
    to: float


class Counterfactual(_Out):
    goal_probability: float
    start: float
    end: float
    needed: bool
    achieved: bool
    changes: list[CounterfactualChange]
    note: str = Field(description="Must be displayed next to any counterfactual")


class TargetFast(_Out):
    probability: float = Field(description="Calibrated probability, 0 to 1. Format as a percentage only in the UI")
    band: str = Field(description="Band id from /meta risk_bands")
    threshold: float = Field(description="This target's decision threshold (Youden)")
    rule_out: float = Field(description="Below this the band is the lowest risk band")
    rule_in: float = Field(description="From this the band is the highest risk band")


class TargetFull(TargetFast):
    uncertainty: Uncertainty
    shap: Shap
    counterfactual: Counterfactual


class Coherence(_Out):
    top_vessel: str
    gap: float
    below_top_vessel: bool


class PhysiologyItem(_Out):
    label: str
    value: Optional[float]
    unit: Optional[str]
    range: tuple[float, float]
    status: Literal["low", "normal", "high", "missing"]


class InputReport(_Out):
    missing: list[str] = Field(description="Features that were absent or null, imputed. Show as 'estimated without ...'")
    ignored: list[str] = Field(description="Request keys that are not model features")


class ModelStamp(_Out):
    created: str
    git_sha: str


class _Prediction(_Out):
    coherence: dict[str, Coherence]
    physiology: dict[str, PhysiologyItem]
    input: InputReport
    model: ModelStamp
    timing_ms: dict[str, float]
    disclaimer: str = Field(default=DISCLAIMER)
    mock: bool = Field(description="True when served from the API_MOCK payload. Never a real prediction")


class PredictResponse(_Prediction):
    targets: dict[str, TargetFull]


class FastPredictResponse(_Prediction):
    targets: dict[str, TargetFast]


# ---------------------------------------------------------------------------------------------
# Response: /meta
# ---------------------------------------------------------------------------------------------

class FeatureStats(_Out):
    median: float
    std: float
    min: float
    max: float


class FeatureMeta(_Out):
    name: str
    label: str
    type: Literal["numeric", "binary", "categorical"]
    unit: Optional[str]
    range: Optional[tuple[float, float]] = Field(description="Clinical reference range, not a slider bound")
    group: str
    mutable: bool = Field(description="True if a patient could plausibly change it (what-if sliders)")
    anchor: Optional[str] = Field(description="Mesh node the feature's SHAP callout is pinned to, or null")
    map: Optional[dict[str, float]] = Field(description="Label -> code for text-coded features")
    allowed: Optional[list[float]] = Field(description="Allowed values for binary and categorical features")
    stats: Optional[FeatureStats] = Field(description="Training-data median, std, min and max (slider defaults and bounds)")


class TargetMeta(_Out):
    id: str
    label: str
    kind: Literal["overall", "vessel"]
    mesh: Optional[str] = Field(description="Exact .glb node name; null for the overall target")
    conditional_on: Optional[str]
    threshold: Optional[float]
    rule_out: Optional[float]
    rule_in: Optional[float]
    family: Optional[str] = Field(description="Chosen model family")
    prevalence: Optional[float] = Field(description="Prevalence in the (referral) development cohort")


class BandMeta(_Out):
    id: str
    label: str
    color: str


class ModelMeta(_Out):
    created: str
    git_sha: str
    protocol: str
    n_patients: int


class MetaResponse(_Out):
    features: list[FeatureMeta]
    groups: list[str] = Field(description="Feature groups in display order")
    targets: list[TargetMeta]
    risk_bands: list[BandMeta] = Field(description="Lowest risk first")
    uncertainty_interval: tuple[float, float] = Field(description="Quantiles behind uncertainty.low and .high")
    forbidden_inputs: list[str] = Field(description="Label columns that must never be sent as inputs")
    model: Optional[ModelMeta]
    disclaimer: str
    mock: bool
    api_version: str


class HealthResponse(_Out):
    status: Literal["ok", "mock", "degraded"]
    mock: bool
    models_loaded: bool
    error: Optional[str] = None
    model: Optional[ModelStamp] = None
    api_version: str = API_VERSION


# ---------------------------------------------------------------------------------------------
# Errors: every non-2xx response has this shape
# ---------------------------------------------------------------------------------------------

class ErrorDetail(_Out):
    field: Optional[str] = None
    message: str
    type: Optional[str] = None


class ErrorBody(_Out):
    code: str = Field(description="validation_error, leakage, models_unavailable, model_mismatch, not_found, "
                                  "method_not_allowed, http_error or internal_error")
    message: str
    details: Optional[list[ErrorDetail]] = None


class ErrorResponse(_Out):
    error: ErrorBody
