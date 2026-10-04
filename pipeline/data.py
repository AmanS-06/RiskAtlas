"""Dataset loading, encoding, the one-time holdout split and the holdout lock."""
import hashlib
import io
import json
import os
import time
import urllib.request
import zipfile

import pandas as pd
from sklearn.model_selection import train_test_split

from pipeline import features, leakage
from pipeline.settings import PROCESSED_DIR, RAW_DIR, REPORTS_DIR, cfg, get_logger, manifest, protocol, seed

log = get_logger(__name__)
HOLDOUT_FILE = PROCESSED_DIR / "holdout_ids.json"
LOCK_FILE = REPORTS_DIR / "holdout_lock.json"
RERUN_ENV = "RISKATLAS_ALLOW_HOLDOUT_RERUN"


class HoldoutAlreadyUsed(RuntimeError):
    pass


def sha256_file(path) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def download() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    try:
        blob = urllib.request.urlopen(cfg()["data"]["url"], timeout=60).read()
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".xlsx"))
            (RAW_DIR / "z_alizadeh_sani.xlsx").write_bytes(z.read(name))
    except Exception as exc:
        raise FileNotFoundError(f"download failed ({exc}); place the xlsx in {RAW_DIR}") from exc


def raw_path():
    files = sorted(RAW_DIR.glob("*.xlsx"))
    if not files:
        download()
        files = sorted(RAW_DIR.glob("*.xlsx"))
    return files[0]


def _encode(series: pd.Series, f: dict) -> pd.Series:
    s = series
    if not pd.api.types.is_numeric_dtype(s):
        s = s.astype(str).str.strip()
    if f["map"]:
        out = s.map(f["map"])
    elif f["type"] == "binary" and not pd.api.types.is_numeric_dtype(s):
        out = s.map({"Y": 1, "N": 0})
    else:
        out = pd.to_numeric(s)
    if out.isna().any():
        raise ValueError(f"unmapped values in {f['raw']}: {sorted(set(s[out.isna()]))}")
    if f["type"] == "binary" and not set(out.unique()) <= {0, 1}:
        raise ValueError(f"{f['raw']} is not binary")
    return out.astype(float)


def load_dataset():
    path = raw_path()
    df = pd.read_excel(path, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    df.index.name = "patient_id"
    feats = features.active()
    X = pd.DataFrame({f["name"]: _encode(df[f["raw"]], f) for f in feats})
    Y = {}
    for t, spec in manifest()["targets"].items():
        col = df[spec["raw"]].astype(str).str.strip()
        if col.nunique() != 2 or spec["positive"] not in set(col):
            raise ValueError(f"unexpected labels in {spec['raw']}: {sorted(col.unique())}")
        Y[t] = (col == spec["positive"]).astype(int)
    Y = pd.DataFrame(Y)
    leakage.check_registry()
    leakage.assert_clean(list(X.columns))
    return X, Y, sha256_file(path)


def _strata(Y: pd.DataFrame) -> pd.Series:
    """Stratify on the number of positive labels. Any class with fewer than 2 rows is folded
    into its nearest neighbour (ties go to the larger class), repeatedly, so the split never
    sees a singleton class."""
    key = Y.sum(axis=1)
    while True:
        counts = key.value_counts()
        rare = counts[counts < 2]
        if rare.empty or len(counts) == 1:
            return key
        k = rare.index[0]
        nearest = min((c for c in counts.index if c != k), key=lambda c: (abs(c - k), -counts[c]))
        key = key.replace(k, nearest)


def holdout_ids(X, Y, sha) -> list:
    if HOLDOUT_FILE.exists():
        saved = json.loads(HOLDOUT_FILE.read_text(encoding="utf-8"))
        if saved["data_sha256"] != sha or saved["n"] != len(X):
            raise ValueError("holdout_ids.json does not match the current dataset")
        return saved["holdout_ids"]
    _, test = train_test_split(X.index, test_size=cfg()["data"]["holdout_fraction"],
                               stratify=_strata(Y), random_state=seed())
    ids = sorted(int(i) for i in test)
    HOLDOUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    HOLDOUT_FILE.write_text(json.dumps({"seed": seed(), "n": len(X), "data_sha256": sha,
                                        "holdout_ids": ids}, indent=1), encoding="utf-8")
    log.info("created holdout split with %d patients", len(ids))
    return ids


def get_dev_split():
    """The original development set: everyone except the locked holdout."""
    X, Y, sha = load_dataset()
    ids = holdout_ids(X, Y, sha)
    return X.drop(index=ids), Y.drop(index=ids), sha


def get_dev():
    """Data the models are developed on. Under the full_cv protocol that is every patient;
    under the holdout protocol the holdout rows are never returned here."""
    if protocol() == "full_cv":
        return load_dataset()
    return get_dev_split()


def open_holdout(fingerprint: str):
    """Only evaluate.py calls this. Every distinct set of models scored on the holdout is
    appended to the lock file, which is committed, so the docs can state honestly how many
    times the holdout was used.

    Re-scoring the same models is allowed freely: it is deterministic and reveals nothing
    new. Scoring different models after the first use is the dangerous case (iterating
    against the holdout), so it needs RISKATLAS_ALLOW_HOLDOUT_RERUN=1 and is recorded."""
    if protocol() != "holdout":
        raise HoldoutAlreadyUsed("the full_cv protocol trains on every patient, so there is no holdout to open; "
                                 "the split-sample result is archived in reports/archive/split_sample_v1/")
    uses = json.loads(LOCK_FILE.read_text(encoding="utf-8"))["uses"] if LOCK_FILE.exists() else []
    seen = {u["model_fingerprint"] for u in uses}
    if uses and fingerprint not in seen and os.environ.get(RERUN_ENV) != "1":
        raise HoldoutAlreadyUsed(f"holdout already used for {len(seen)} other model set(s), see {LOCK_FILE}; "
                                 f"set {RERUN_ENV}=1 to score new models anyway (it will be recorded)")
    X, Y, sha = load_dataset()
    ids = holdout_ids(X, Y, sha)
    if fingerprint not in seen:
        uses.append({"opened": time.strftime("%Y-%m-%d %H:%M:%S"), "model_fingerprint": fingerprint})
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCK_FILE.write_text(json.dumps({"distinct_model_sets_evaluated": len(uses), "uses": uses}, indent=1),
                             encoding="utf-8")
        if len(uses) > 1:
            log.warning("holdout now used for %d distinct model sets; report this in the docs", len(uses))
    return X.loc[ids], Y.loc[ids]
