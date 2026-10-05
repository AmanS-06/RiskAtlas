# syntax=docker/dockerfile:1
#
# RiskAtlas in one container: FastAPI serves the built web app and the API (under /api) on one port.
# Build:  docker build -t riskatlas .
# Run:    docker run --rm -p 8000:7860 riskatlas        then open http://localhost:8000
# Honours $PORT (Render, Railway, Cloud Run set it); defaults to 7860, which is what Hugging Face Spaces expects.
# Start-up loads the four models and runs one warm-up prediction: allow 15 to 20 s before /api/health answers.
# Steps and measurements: docs/DEPLOY.md.

# ---- 1. build the web app ---------------------------------------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The About tab bundles the licence page from the repo root (web/src/dashboard/Dashboard.tsx imports ../../../ASSETS_AND_LICENSES.md).
COPY ASSETS_AND_LICENSES.md /src/ASSETS_AND_LICENSES.md
# Same origin: the client calls /api/*. Set here so a stray web/.env file cannot change it.
ENV VITE_API_BASE=/api
RUN npm run build

# ---- 2. runtime -------------------------------------------------------------------------------------------------
FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# requirements.txt exactly as pinned (numba 0.65.1, llvmlite 0.47.0 ...). Its own layer: code edits do not reinstall it.
# xgboost pulls in nvidia-nccl-cu12 (about 470 MB) on x86-64 Linux; it is only loaded for GPU training, never here.
COPY requirements.txt ./
RUN pip install -r requirements.txt \
 && pip uninstall -y nvidia-nccl-cu12

# Only what the API reads at run time: code, config/, the trained models, the example payload (used for /meta
# fallbacks and mock mode) and the built web app. No data/, no tests, no docs, no training reports.
COPY api/ ./api/
COPY pipeline/ ./pipeline/
COPY config/ ./config/
COPY models/ ./models/
COPY reports/example_prediction.json ./reports/example_prediction.json
COPY ASSETS_AND_LICENSES.md ./
COPY --from=web /src/web/dist ./web/dist

# Non-root. UID 1000 is what Hugging Face Spaces runs containers as. matplotlib and numba want a writable cache dir.
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin riskatlas \
 && mkdir -p /tmp/matplotlib /tmp/numba && chown riskatlas /tmp/matplotlib /tmp/numba
USER riskatlas

ENV PORT=7860 \
    API_WARMUP=1 \
    FORWARDED_ALLOW_IPS=* \
    MPLCONFIGDIR=/tmp/matplotlib \
    NUMBA_CACHE_DIR=/tmp/numba
EXPOSE 7860

# The models load before /api/health answers (about 15 to 20 s), hence the long start period. 503 counts as unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request as u; u.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '7860'), timeout=4)"

# One process: each worker would load its own copy of the models and caches (docs/api.md section 1).
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
