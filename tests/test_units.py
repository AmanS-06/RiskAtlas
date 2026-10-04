"""Pure unit tests. No dataset or trained models needed, so these run on a fresh clone."""
import json

import numpy as np
import pandas as pd
import pytest

from pipeline import data, metrics
from pipeline.settings import manifest, risk_bands


def test_manifest_targets_complete():
    targets = manifest()["targets"]
    assert set(targets) == {"CAD", "LAD", "LCX", "RCA"}
    meshes = [s["mesh"] for s in targets.values() if s.get("mesh")]
    assert len(meshes) == len(set(meshes))


def test_band_uses_risk_band_ids():
    ids = [b["id"] for b in risk_bands()]
    ops = {"rule_out": 0.2, "threshold": 0.5, "rule_in": 0.8}
    assert [metrics.band(p, ops) for p in (0.1, 0.5, 0.9)] == ids


def test_operating_points_are_ordered():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, 300)
    p = np.clip(0.35 * y + 0.65 * rng.random(300), 0, 1)
    ops = metrics.operating_points(y, p)
    assert 0 <= ops["rule_out"] <= ops["threshold"] <= ops["rule_in"] <= 1


def test_strata_folds_every_singleton():
    # label counts per row: 0, 0, 1, 1, 2, 3 -> classes 2 and 3 are singletons
    Y = pd.DataFrame({"a": [0, 0, 1, 1, 1, 1], "b": [0, 0, 0, 0, 1, 1], "c": [0, 0, 0, 0, 0, 1]})
    assert data._strata(Y).value_counts().min() >= 2


@pytest.fixture
def stub_holdout(tmp_path, monkeypatch):
    X = pd.DataFrame({"age": range(10)})
    Y = pd.DataFrame({"CAD": [0, 1] * 5})
    monkeypatch.setattr(data, "LOCK_FILE", tmp_path / "holdout_lock.json")
    monkeypatch.setattr(data, "load_dataset", lambda: (X, Y, "sha"))
    monkeypatch.setattr(data, "holdout_ids", lambda X, Y, sha: [0, 1])
    monkeypatch.setattr(data, "protocol", lambda: "holdout")
    monkeypatch.delenv(data.RERUN_ENV, raising=False)
    return tmp_path / "holdout_lock.json"


def test_holdout_same_models_can_rerun(stub_holdout):
    data.open_holdout("models-v1")
    data.open_holdout("models-v1")
    assert len(json.loads(stub_holdout.read_text(encoding="utf-8"))["uses"]) == 1


def test_holdout_new_models_blocked_then_recorded(stub_holdout, monkeypatch):
    data.open_holdout("models-v1")
    with pytest.raises(data.HoldoutAlreadyUsed):
        data.open_holdout("models-v2")
    monkeypatch.setenv(data.RERUN_ENV, "1")
    data.open_holdout("models-v2")
    lock = json.loads(stub_holdout.read_text(encoding="utf-8"))
    assert [u["model_fingerprint"] for u in lock["uses"]] == ["models-v1", "models-v2"]
    assert lock["distinct_model_sets_evaluated"] == 2
