"""Environment-driven API settings. Read when the app is created, so tests can set them first.

API_MOCK                    1 serves reports/example_prediction.json shaped responses (no models loaded)
API_CORS_ORIGINS            comma-separated allowed origins, or * for any (default http://localhost:5173)
API_CACHE_FAST              entries in the /predict/fast LRU cache, 0 disables it (default 512)
API_CACHE_FULL              entries in the /predict LRU cache, 0 disables it (default 64)
API_WARMUP                  0 skips the warm-up prediction at startup (default on; the first full
                            prediction otherwise takes about three times longer)
"""
import os

DEFAULT_CORS = "http://localhost:5173"
DEFAULT_CACHE_FAST = 512
DEFAULT_CACHE_FULL = 64
TRUE = {"1", "true", "yes", "on"}


def mock_enabled() -> bool:
    return os.environ.get("API_MOCK", "").strip().lower() in TRUE


def warmup_enabled() -> bool:
    return os.environ.get("API_WARMUP", "1").strip().lower() in TRUE


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
