"""Leakage guard. Forbidden names come from config/manifest.yaml; violations raise."""
from pipeline import features
from pipeline.settings import manifest


class LeakageError(RuntimeError):
    pass


def forbidden() -> set:
    m = manifest()
    names = set(m.get("forbidden_features", [])) | set(m["targets"]) | {t["raw"] for t in m["targets"].values()}
    return {str(n).lower() for n in names}


def assert_clean(names, target=None) -> None:
    bad = sorted(str(n) for n in names if str(n).lower() in forbidden())
    if bad:
        raise LeakageError(f"forbidden columns used as inputs (target={target}): {bad}")


def check_registry() -> None:
    for f in features.active():
        assert_clean([f["name"], f["raw"]])
