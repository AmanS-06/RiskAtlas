import json

import pytest

from pipeline import data, features, leakage
from pipeline.settings import RAW_DIR

# Data-dependent tests skip on a fresh clone instead of failing or downloading.
needs_data = pytest.mark.skipif(not any(RAW_DIR.glob("*.xlsx")), reason="dataset not in data/raw")
# Never create the split from a test: only training may write holdout_ids.json.
needs_split = pytest.mark.skipif(not data.HOLDOUT_FILE.exists(),
                                 reason="holdout split not created yet; run python -m pipeline.train")


def test_registry_is_clean():
    leakage.check_registry()


@pytest.mark.parametrize("bad", ["LAD", "lcx", "RCA", "Cath", "CAD"])
def test_forbidden_names_raise(bad):
    with pytest.raises(leakage.LeakageError):
        leakage.assert_clean(["age", bad])


def test_registry_with_injected_label_raises(monkeypatch):
    monkeypatch.setattr(features, "active", lambda: [{"name": "x", "raw": "LAD"}])
    with pytest.raises(leakage.LeakageError):
        leakage.check_registry()


@needs_data
def test_loader_never_returns_labels():
    X, Y, _ = data.load_dataset()
    assert not {c.lower() for c in X.columns} & leakage.forbidden()
    assert all(t not in X.columns for t in Y.columns)


@needs_data
@needs_split
def test_holdout_rows_not_in_dev_split():
    X, _, _ = data.get_dev_split()
    ids = json.loads(data.HOLDOUT_FILE.read_text(encoding="utf-8"))["holdout_ids"]
    assert not set(ids) & set(X.index)


@needs_data
@needs_split
def test_get_dev_follows_the_protocol(monkeypatch):
    ids = set(json.loads(data.HOLDOUT_FILE.read_text(encoding="utf-8"))["holdout_ids"])
    monkeypatch.setattr(data, "protocol", lambda: "holdout")
    assert not ids & set(data.get_dev()[0].index)
    monkeypatch.setattr(data, "protocol", lambda: "full_cv")
    assert ids <= set(data.get_dev()[0].index)


def test_full_cv_protocol_has_no_holdout_to_open(monkeypatch):
    monkeypatch.setattr(data, "protocol", lambda: "full_cv")
    with pytest.raises(data.HoldoutAlreadyUsed):
        data.open_holdout("any-models")
