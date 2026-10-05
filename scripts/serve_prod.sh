#!/usr/bin/env bash
# One-process demo: builds the web app if web/dist is missing, then serves the web app and the API together.
#
#   scripts/serve_prod.sh                  http://127.0.0.1:8000
#   PORT=9000 scripts/serve_prod.sh        another port (hosts that set $PORT work unchanged)
#   HOST=0.0.0.0 scripts/serve_prod.sh     reachable from other devices on the network
#   REBUILD=1 scripts/serve_prod.sh        rebuild web/dist first (after changing the web code)
#   PYTHON=/path/to/python ...             Python with the requirements installed (default: .venv, else python3)
#
# Needs: the Python packages from requirements.txt, and Node 20.19+ or 22.12+ only when web/dist has to be built.
# Start-up loads the models and runs one warm-up prediction: the page works after about 15 to 20 s. Docs: docs/DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

if [ -n "${PYTHON:-}" ]; then
  PY="$PYTHON"
elif [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
else
  PY="$(command -v python3 || command -v python || true)"
fi
if [ -z "$PY" ] || ! "$PY" -c "import importlib.util as u, sys; sys.exit(0 if all(u.find_spec(m) for m in ('uvicorn', 'fastapi', 'shap', 'xgboost')) else 1)" 2>/dev/null; then
  echo "Python with the project requirements not found (looked for .venv/bin/python, then python3)." >&2
  echo "Set it up once:  python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if [ "${REBUILD:-0}" = "1" ] || [ ! -f web/dist/index.html ]; then
  command -v npm >/dev/null || { echo "web/dist is missing and npm is not installed (Node 20.19+ or 22.12+ needed to build it)." >&2; exit 1; }
  echo "Building the web app (web/dist) ..."
  (cd web && { [ -d node_modules ] || npm ci; } && VITE_API_BASE=/api npm run build)
fi

echo "RiskAtlas on http://${HOST}:${PORT}  (one process: web app + API under /api; ready in about 15 to 20 s)"
export SERVE_WEB=1
exec "$PY" -m uvicorn api.main:app --host "$HOST" --port "$PORT"
