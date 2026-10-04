"""Paths, config loading, seeding and logging. Depends on nothing else in the repo."""
import logging
import os
import random
from functools import lru_cache
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(os.environ.get("RISKATLAS_ROOT", Path(__file__).resolve().parents[1]))
CONFIG_DIR = ROOT / "config"
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
EXTERNAL_DIR = ROOT / "data" / "external"
MODELS_DIR = ROOT / "models"
REPORTS_DIR = ROOT / "reports"


def read_yaml(path):
    # Explicit utf-8: Windows defaults to cp1252 and would choke on non-ASCII comments.
    return yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}


@lru_cache(maxsize=None)
def cfg() -> dict:
    """ML hyperparameters (config/ml.yaml)."""
    return read_yaml(os.environ.get("RISKATLAS_ML_CONFIG", CONFIG_DIR / "ml.yaml"))


@lru_cache(maxsize=None)
def manifest() -> dict:
    """Targets and forbidden features (config/manifest.yaml), shared with the API."""
    m = read_yaml(CONFIG_DIR / "manifest.yaml")
    if not m.get("targets"):
        raise ValueError("manifest.yaml defines no targets")
    for t, spec in m["targets"].items():
        missing = {"raw", "positive"} - set(spec)
        if missing:
            raise ValueError(f"manifest.yaml target {t} is missing {sorted(missing)}")
    return m


def split_targets() -> tuple:
    """(overall targets, vessel targets). Vessels are the targets with a mesh in manifest.yaml."""
    t = manifest()["targets"]
    return [k for k, s in t.items() if not s.get("mesh")], [k for k, s in t.items() if s.get("mesh")]


@lru_cache(maxsize=None)
def risk_bands() -> tuple:
    """Band definitions, lowest risk first (config/risk_bands.yaml). Cut points live in models/metadata.json."""
    bands = read_yaml(CONFIG_DIR / "risk_bands.yaml").get("bands") or []
    if len(bands) != 3 or not all("id" in b for b in bands):
        raise ValueError("risk_bands.yaml must define exactly three bands with ids, lowest risk first")
    return tuple(bands)


def protocol() -> str:
    """full_cv (develop on everyone, validate by CV of the whole procedure) or holdout."""
    p = cfg().get("validation", {}).get("protocol", "holdout")
    if p not in ("full_cv", "holdout"):
        raise ValueError(f"unknown validation protocol {p!r}")
    return p


def seed() -> int:
    return int(cfg()["seed"])


def seed_all() -> None:
    random.seed(seed())
    np.random.seed(seed())


def get_logger(name: str) -> logging.Logger:
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return logging.getLogger(name)
