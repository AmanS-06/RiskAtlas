"""Feature registry read from config/features.yaml."""
from functools import lru_cache

from pipeline.settings import CONFIG_DIR, read_yaml

DEFAULTS = dict(label=None, type="binary", unit=None, range=None, group="symptoms",
                mutable=False, anchor=None, use=True, map=None)


@lru_cache(maxsize=None)
def registry() -> tuple:
    rows = read_yaml(CONFIG_DIR / "features.yaml")
    out = [{**DEFAULTS, **r} for r in rows]
    for r in out:
        r["label"] = r["label"] or r["name"]
    for key in ("name", "raw"):
        vals = [r[key] for r in out]
        if len(vals) != len(set(vals)):
            raise ValueError(f"duplicate {key} in features.yaml")
    return tuple(out)


def active() -> list:
    return [f for f in registry() if f["use"]]


def names() -> list:
    return [f["name"] for f in active()]


def by_name() -> dict:
    return {f["name"]: f for f in registry()}


def types(feature_names=None, extra=None) -> dict:
    t = {f["name"]: f["type"] for f in registry()}
    t.update(extra or {})
    return {n: t[n] for n in (feature_names or names())}
