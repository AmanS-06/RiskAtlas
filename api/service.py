"""Prediction engines behind the API: the real models and the mock, plus /meta and an LRU cache.

Routes call engine.predict() and engine.meta; they never touch pipeline.predict directly.
Everything here is synchronous. FastAPI runs the sync route functions in its threadpool, so a
slow prediction never blocks the event loop.
"""
import copy
import json
import logging
import math
import threading
import time
from collections import OrderedDict
from typing import Optional

import numpy as np

from api import settings
from api.schemas import API_VERSION, DISCLAIMER
from pipeline import features, leakage
from pipeline.settings import MODELS_DIR, REPORTS_DIR, cfg, manifest, risk_bands, seed, split_targets

log = logging.getLogger("api")
EXAMPLE_FILE = REPORTS_DIR / "example_prediction.json"
HEAVY_PARTS = ("uncertainty", "shap", "counterfactual")


class ServiceUnavailable(RuntimeError):
    """Models cannot be served. Maps to HTTP 503. code is models_unavailable or model_mismatch."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


class LRUCache:
    """Small thread-safe LRU. size 0 disables it."""

    def __init__(self, size: int):
        self.size, self._data, self._lock = size, OrderedDict(), threading.Lock()

    def get(self, key):
        if not self.size:
            return None
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def put(self, key, value) -> None:
        if not self.size:
            return
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.size:
                self._data.popitem(last=False)

    def __len__(self):
        return len(self._data)


def cache_key(inputs: dict) -> str:
    """Identical requests share a key: known features by value (null equals absent), unknown keys by name."""
    names = set(features.names())
    known = {k: float(v) for k, v in inputs.items() if k in names and v is not None}
    return json.dumps([sorted(known.items()), sorted(k for k in inputs if k not in names)])


# ---------------------------------------------------------------------------------------------
# /meta, built from config/ and models/metadata.json
# ---------------------------------------------------------------------------------------------

def _allowed(spec: dict, stats: Optional[dict]):
    if spec["map"]:
        return sorted({float(v) for v in spec["map"].values()})
    if spec["type"] == "binary":
        return [0.0, 1.0]
    if spec["type"] == "categorical" and stats:
        return [float(i) for i in range(int(stats["min"]), int(stats["max"]) + 1)]
    return None


def _example_targets() -> dict:
    try:
        return json.loads(EXAMPLE_FILE.read_text(encoding="utf-8"))["output"]["targets"]
    except (OSError, KeyError, ValueError):
        return {}


def build_meta(model_meta: Optional[dict], mock: bool) -> dict:
    """Everything the frontend needs, from config. model_meta is models/metadata.json: it supplies cut points,
    feature statistics and model info. Without it (or in mock mode, where model info is withheld) cut points
    fall back to the example payload."""
    stats = (model_meta or {}).get("feature_stats", {})
    feats = [{"name": f["name"], "label": f["label"], "type": f["type"], "unit": f["unit"], "range": f["range"],
              "group": f["group"], "mutable": f["mutable"], "anchor": f["anchor"], "map": f["map"],
              "allowed": _allowed(f, stats.get(f["name"])), "stats": stats.get(f["name"])}
             for f in features.active()]
    overall, vessels = split_targets()
    ops_fallback = _example_targets()
    targets = []
    for t, spec in manifest()["targets"].items():
        ops = ((model_meta or {}).get("targets", {}).get(t)) or ops_fallback.get(t) or {}
        targets.append({"id": t, "label": spec.get("label", t), "kind": "vessel" if t in vessels else "overall",
                        "mesh": spec.get("mesh"), "conditional_on": spec.get("conditional_on"),
                        "threshold": ops.get("threshold"), "rule_out": ops.get("rule_out"),
                        "rule_in": ops.get("rule_in"), "family": ops.get("family"),
                        "prevalence": ops.get("prevalence")})
    model = None
    if model_meta and not mock:
        model = {k: model_meta[k] for k in ("created", "git_sha", "protocol", "n_patients")}
    return {"features": feats, "groups": list(dict.fromkeys(f["group"] for f in feats)), "targets": targets,
            "risk_bands": [{"id": b["id"], "label": b.get("label", b["id"]), "color": b["color"]}
                           for b in risk_bands()],
            "uncertainty_interval": cfg()["uncertainty"]["interval"],
            "forbidden_inputs": list(manifest().get("forbidden_features", [])),
            "model": model, "disclaimer": DISCLAIMER, "mock": mock, "api_version": API_VERSION}


def _model_meta_file() -> Optional[dict]:
    try:
        return json.loads((MODELS_DIR / "metadata.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------------------------------------
# Engines
# ---------------------------------------------------------------------------------------------

class RealEngine:
    """The trained models. Loaded once, at startup."""
    mock = False

    def __init__(self, ra, fast_cache: int, full_cache: int):
        self.ra = ra
        self.meta = build_meta(ra.meta, mock=False)
        self.stamp = {"created": ra.meta["created"], "git_sha": ra.meta["git_sha"]}
        self._fast, self._full = LRUCache(fast_cache), LRUCache(full_cache)
        # The SHAP explainers share a masker with mutable buffers and draw their permutations from numpy's
        # global RNG, so full predictions run one at a time, and each one reseeds that RNG so the same
        # request always returns the same explanation. See docs/backend_findings.md.
        self._full_lock = threading.Lock()

    @classmethod
    def load(cls) -> "RealEngine":
        # Imported here so mock mode never pays for shap, xgboost and sklearn.
        from pipeline.predict import ModelMismatch, RiskAtlas
        try:
            ra = RiskAtlas()
        except ModelMismatch as exc:
            raise ServiceUnavailable("model_mismatch", f"{exc}. Retrain with: python -m pipeline train") from exc
        except FileNotFoundError as exc:
            raise ServiceUnavailable("models_unavailable",
                                     f"Model files not found ({exc.filename or exc}). "
                                     "Train them with: python -m pipeline train") from exc
        except Exception as exc:
            log.exception("failed to load models")
            raise ServiceUnavailable("models_unavailable", f"Models could not be loaded ({type(exc).__name__}: {exc})") from exc
        fast, full = settings.cache_sizes()
        engine = cls(ra, fast, full)
        if settings.warmup_enabled():
            engine.warm_up()
        return engine

    def warm_up(self) -> None:
        """One full prediction for the median patient, discarded. The first call into SHAP is several times
        slower than the rest, and without this the first user would pay for it."""
        t0 = time.perf_counter()
        median = {n: s["median"] for n, s in self.ra.meta["feature_stats"].items()}
        with self._full_lock:
            self.ra.predict_all(median)
        log.info("warm-up prediction took %.1f s", time.perf_counter() - t0)

    def health(self) -> dict:
        return {"status": "ok", "mock": False, "models_loaded": True, "error": None, "model": self.stamp}

    def predict(self, inputs: dict, fast: bool) -> tuple:
        """Returns (response dict, cache hit). The dict is the caller's to keep: it is a copy."""
        t0 = time.perf_counter()
        cache, key = (self._fast if fast else self._full), cache_key(inputs)
        hit = cache.get(key)
        if hit is not None:
            out = copy.deepcopy(hit)
            out["timing_ms"] = {**dict.fromkeys(HEAVY_PARTS, 0.0), "total": round((time.perf_counter() - t0) * 1000, 3)}
            return {**out, "mock": False}, True
        if fast:
            out = self.ra.predict_fast(inputs)
        else:
            with self._full_lock:
                np.random.seed(seed())
                out = self.ra.predict_all(inputs)
        cache.put(key, copy.deepcopy(out))
        return {**out, "mock": False}, False


class MockEngine:
    """Serves reports/example_prediction.json. Probabilities, SHAP, uncertainty and counterfactuals are
    the fixed example values and do NOT depend on the request. input and physiology are computed from
    the request (from config only) so the dashboard's missing-value and range logic can be built too.
    Every response says mock: true."""
    mock = True
    stamp = {"created": "mock", "git_sha": "mock"}

    def __init__(self):
        try:
            self.example = json.loads(EXAMPLE_FILE.read_text(encoding="utf-8"))["output"]
        except (OSError, KeyError, ValueError) as exc:
            raise ServiceUnavailable("models_unavailable", f"API_MOCK is set but {EXAMPLE_FILE.name} "
                                     f"could not be read ({exc})") from exc
        self.meta = build_meta(_model_meta_file(), mock=True)

    @classmethod
    def load(cls) -> "MockEngine":
        return cls()

    def health(self) -> dict:
        return {"status": "mock", "mock": True, "models_loaded": False, "error": None, "model": self.stamp}

    @staticmethod
    def physiology(values: dict) -> dict:
        out = {}
        for f in features.active():
            if f["range"]:
                v = values.get(f["name"])
                v = None if v is None or math.isnan(v) else float(v)
                lo, hi = f["range"]
                status = "missing" if v is None else ("low" if v < lo else "high" if v > hi else "normal")
                out[f["name"]] = {"label": f["label"], "value": v, "unit": f["unit"], "range": [lo, hi],
                                  "status": status}
        return out

    def predict(self, inputs: dict, fast: bool) -> tuple:
        t0 = time.perf_counter()
        out = copy.deepcopy(self.example)
        if fast:
            for t in out["targets"].values():
                for part in HEAVY_PARTS:
                    t.pop(part, None)
        names = features.names()
        out["input"] = {"missing": [n for n in names if inputs.get(n) is None],
                        "ignored": sorted(k for k in inputs if k not in names)}
        out["physiology"] = self.physiology(inputs)
        out["model"] = dict(self.stamp)
        out["timing_ms"] = {**dict.fromkeys(HEAVY_PARTS, 0.0), "total": round((time.perf_counter() - t0) * 1000, 3)}
        return {**out, "mock": True}, False


def load_engine(mock: bool):
    return MockEngine.load() if mock else RealEngine.load()
