"""Environment-driven API settings. Read when the app is created, so tests can set them first.

API_MOCK                    1 serves reports/example_prediction.json shaped responses (no models loaded)
API_CORS_ORIGINS            comma-separated allowed origins, or * for any (default http://localhost:5173)
API_CACHE_FAST              entries in the /predict/fast LRU cache, 0 disables it (default 512)
API_CACHE_FULL              entries in the /predict LRU cache, 0 disables it (default 64)
API_WARMUP                  0 skips the warm-up prediction at startup (default on; the first full
                            prediction otherwise takes about three times longer)
SERVE_WEB                   single-origin mode: this process also serves the built web app (web/dist) and the
                            API under /api. Unset: on when web/dist/index.html exists (the uvicorn target
                            `api.main:app` only), 1 forces it on, 0 forces it off
WEB_DIST                    folder holding the built web app (default web/dist); setting it turns serving on
"""
import os
from pathlib import Path
from typing import Optional

DEFAULT_CORS = "http://localhost:5173"
DEFAULT_WEB_DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
DEFAULT_CACHE_FAST = 512
DEFAULT_CACHE_FULL = 64
TRUE = {"1", "true", "yes", "on"}
FALSE = {"0", "false", "no", "off"}


def mock_enabled() -> bool:
    return os.environ.get("API_MOCK", "").strip().lower() in TRUE


def warmup_enabled() -> bool:
    return os.environ.get("API_WARMUP", "1").strip().lower() in TRUE


def web_dist(auto: bool = False) -> Optional[Path]:
    """The folder of the built web app to serve, or None. SERVE_WEB=0 means never. SERVE_WEB=1 or a WEB_DIST
    value means serve it (the caller checks that index.html is there). Otherwise auto=True serves the default
    folder if it holds an index.html, so that a plain `uvicorn api.main:app` after `npm run build` is one process."""
    flag = os.environ.get("SERVE_WEB", "").strip().lower()
    if flag in FALSE:
        return None
    given = os.environ.get("WEB_DIST", "").strip()
    path = Path(given) if given else DEFAULT_WEB_DIST
    if flag in TRUE or given or (auto and (path / "index.html").is_file()):
        return path
    return None


def cors_origins() -> list:
    raw = os.environ.get("API_CORS_ORIGINS", DEFAULT_CORS)
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def _size(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return max(0, int(raw)) if raw else default
    except ValueError:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from None


def cache_sizes() -> tuple:
    """(fast, full) LRU sizes."""
    return _size("API_CACHE_FAST", DEFAULT_CACHE_FAST), _size("API_CACHE_FULL", DEFAULT_CACHE_FULL)
