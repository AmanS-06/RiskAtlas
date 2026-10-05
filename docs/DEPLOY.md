# Deploying RiskAtlas

**Deploying needs a person with an account.** Nothing here has been deployed: there is no hosted demo yet. What exists is
a build that runs as **one process on one port**, a Dockerfile, a Render blueprint, a Hugging Face Spaces recipe and a
laptop script, plus the evidence that the production build works (section 8, which also lists what could *not* be
checked from the machine this was prepared on).

Any claim about a host's limits (RAM, CPU, sleep time, build minutes, prices) is marked **verify**: read the host's own
pricing page before relying on it. They change, and they could not be checked from here.

## 1. How it works

In development there are two processes: the API on `:8000` and the Vite dev server on `:5173`, which proxies `/api` to
the API and strips the prefix. In production the API process does both jobs (`api/main.py`, `api/settings.py`):

| URL | Served |
|---|---|
| `/`, `/index.html` and any other path without a file extension | the built web app (`web/dist/index.html`, the single page) |
| `/assets/*` | hashed JS and CSS, `Cache-Control: public, max-age=31536000, immutable`, gzip when the browser accepts it |
| `/models3d/*` | the 3D models (`model/gltf-binary`) and their licence files, `public, max-age=3600` |
| `/api/health`, `/api/meta`, `/api/predict`, `/api/predict/fast` | the API, which is what the built client calls |
| `/health`, `/meta`, `/predict`, `/predict/fast`, `/docs`, `/openapi.json` | the same API at the root, exactly as before (dev flow, tests and `docs/api.md` are unchanged) |
| any other `/api/*` | the JSON error envelope, `404 {"error": {"code": "not_found", ...}}`, never `index.html` |

A missing file with an extension (`/assets/old-hash.js`) is a 404, not the page. There is no CORS to configure: the page
and the API share an origin. `API_CORS_ORIGINS` still works if you serve the web app elsewhere.

**When it switches on.** `uvicorn api.main:app` serves `web/dist` automatically if `web/dist/index.html` exists. Otherwise
set `SERVE_WEB=1` (use `web/dist`) or `WEB_DIST=/path/to/dist`. `SERVE_WEB=0` turns it off. Without a build the API
starts as before and logs a warning if you asked for the web app. Code that calls `create_app()` directly (the tests) gets
the web app only when `SERVE_WEB` or `WEB_DIST` is set, so an existing `web/dist` never changes the API tests.

**Port and host.** `uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}` is the start command for any host that sets
`$PORT` (Render, Railway, Cloud Run). The Docker image runs the same command with `7860` as the default, which is the
port Hugging Face Spaces expects.

**The built client** calls `/api` because `web/src/api/index.ts` defaults `VITE_API_BASE` to `/api`; the Dockerfile and
the scripts also set it explicitly, so a stray `web/.env.local` cannot change a build. Variables: `.env.example`.

## 2. Run it on a laptop (the demo that cannot fail)

One process, `http://127.0.0.1:8000`, no network needed afterwards (the browser test below checked that every request the
page makes goes to that one origin; only the optional `/docs` page loads Swagger from a CDN).

Linux or macOS:

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
(cd web && npm ci && npm run build)       # Node 20.19+ or 22.12+; writes web/dist
uvicorn api.main:app --port 8000          # ready after about 20 s; open http://127.0.0.1:8000
```

Or `scripts/serve_prod.sh`: it picks `.venv` if present, builds `web/dist` if it is missing, then starts the server
(`PORT=9000`, `HOST=0.0.0.0` for other devices on the network, `REBUILD=1` after changing the web code).

Windows (PowerShell), from the repository root:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
powershell -ExecutionPolicy Bypass -File scripts\serve_prod.ps1       # builds web\dist if missing, serves :8000
```

The `.ps1` script has only been read and reasoned through, not run (no PowerShell on the machine it was written on): if it
misbehaves, the manual route is `cd web; npm ci; npm run build; cd ..; .venv\Scripts\python -m uvicorn api.main:app --port 8000`.
If a managed laptop blocks scripts or numba, see the Troubleshooting section of the README (the pins in
`requirements.txt` exist for that case).

Smoke test the result with the checklist in section 6. Rehearse on the machine you will present from.

## 3. Render (free web service, Docker)

Needs a Render account (https://render.com) and the project on GitHub. Free tier terms **verify**: https://render.com/pricing.

1. Push this branch to a GitHub repository Render can read (a fork is fine). `Dockerfile` and `render.yaml` must be at the
   repository root.
2. Render dashboard, **New**, **Blueprint**. Connect GitHub, pick the repository and the branch. Render reads
   `render.yaml`: one web service `riskatlas`, Docker runtime, free plan, health check `/api/health`.
3. **Apply**. The first build installs the Python packages and builds the web app: several minutes (**verify**: build
   minutes limits). Watch the **Logs** tab. The log line `engine ready` and `Uvicorn running on http://0.0.0.0:...`
   mean it is up.
4. Open the `https://<name>.onrender.com` URL on the service page, then run the smoke test (section 6).

No blueprint? **New**, **Web Service**, connect the repository, Language **Docker**, Instance type **Free**, Advanced,
Health Check Path `/api/health`. No environment variable is required: Render sets `PORT` and the image honours it.

**Honest limits, all to verify on the pricing page and the service's Settings:**

- *Sleep.* Free web services spin down after a period without traffic and take on the order of a minute to wake (the
  figure in the project notes was about 50 s). The app then needs its own **18 to 21 s** to load the models (measured). Open the
  URL a few minutes before you present, and do not leave a judge's first click to a cold start.
- *RAM.* Measured: **431 MiB** resident when idle, **444 MiB** at the peak during full predictions (of which about
  166 MiB is file-backed library pages the kernel can drop). If the free limit is 512 MB (**verify**), that is a margin
  of roughly 70 MiB: it should fit, but an out-of-memory restart in the logs means you need a larger instance or
  Hugging Face (next section).
- *CPU.* The models are single-threaded in practice (1 pinned core gave the same timings as 4). A free instance with a
  fractional CPU share (**verify**) will be proportionally slower than the figures in section 8.
- *No rate limit.* A public link has no authentication. Full predictions run one at a time on one core, so a visitor
  hammering `/api/predict` slows everyone down.

## 4. Hugging Face Spaces (Docker Space)

Needs a Hugging Face account (https://huggingface.co) and an access token with write permission. Hardware and sleep
policy **verify**: https://huggingface.co/pricing and the Spaces documentation.

1. **New Space** (huggingface.co/new-space): name `riskatlas`, **SDK: Docker**, template **Blank**, hardware **CPU
   basic** (free), visibility public. Create.
2. On your computer, clone the empty Space and copy the project into it. From the project's repository root:

   ```bash
   git clone https://huggingface.co/spaces/<your-user>/riskatlas ../riskatlas-space
   git archive HEAD | tar -x -C ../riskatlas-space          # tracked files only, no .git, no node_modules
   cp docs/hf_space_README.md ../riskatlas-space/README.md  # the Space README with the front matter it needs
   cd ../riskatlas-space
   git add -A && git commit -m "RiskAtlas" && git push
   ```

   When asked for a password, paste the access token. (No git? In the Space, **Files**, **Add file**, **Upload files**:
   drag the project folder in, then replace `README.md` with `docs/hf_space_README.md`.) The project's own `README.md` must
   not be what the Space shows: it has no front matter, and the Space would not know to use Docker. Largest tracked file
   in this repository is about 1 MB; Hub per-file limits **verify**.
3. The Space builds from the `Dockerfile` by itself (**Logs** at the top of the Space page). When it says **Running**, the
   app is under the **App** tab. For the link you give out, use the Space's own address,
   `https://<your-user>-riskatlas.hf.space` (**verify** the exact form under the Space's menu, **Embed this Space**):
   it opens the app full screen, which is what the 3D view and the sticky results column are designed for.

The port is the one the front matter declares (`app_port: 7860`) and the image's default, so nothing to set. The
container runs as UID 1000 (what the Spaces documentation recommends, **verify**) and writes nothing to the application
folder.

**Limits to verify:** the free CPU hardware's RAM and vCPU count (the app needs about 450 MiB), the inactivity sleep and
how long a wake takes, and build time limits. Spaces is usually the more comfortable of the two for memory; Render is
the simpler to click through.

## 5. Docker on your own machine

```bash
docker build -t riskatlas .
docker run --rm -p 8000:7860 riskatlas        # http://localhost:8000 after about 20 s; the image listens on 7860
docker run --rm -e PORT=8000 -p 8000:8000 riskatlas   # or choose the port with $PORT
```

The image is multi-stage: `node:22-slim` runs `npm ci && npm run build`; `python:3.11-slim` installs `requirements.txt`
exactly as pinned (numba 0.65.1, llvmlite 0.47.0, ...), then removes `nvidia-nccl-cu12` (470 MB that xgboost installs on
x86-64 Linux and only loads for GPU training; removed after the install, and a run without it gave the same
predictions), and copies only `api/`, `pipeline/`, `config/`, `models/`, `reports/example_prediction.json`,
`ASSETS_AND_LICENSES.md` and the built `web/dist`. It runs as a non-root user (UID 1000), keeps `API_WARMUP=1`, has a
`HEALTHCHECK` on `/api/health` (60 s start period) and one uvicorn process (each worker would load its own copy of the
models). `FORWARDED_ALLOW_IPS=*` makes redirects use the proxy's scheme and host (checked with an `X-Forwarded-Proto: https` request).

**This Dockerfile has not been built.** See section 8: the Docker daemon was not available where it was written, so
the build and the image size are unmeasured. The Python packages alone are 992 MB on disk (measured in a virtual
environment, nccl already removed), so expect an image a little over 1 GB. If `docker build` fails, the error will be in
one of the steps listed in section 8 as run natively; the first thing to try is `docker build --no-cache .`.

## 6. Smoke test after every deploy

Replace `$URL` with the public address.

1. `$URL/api/health` returns 200 with `"status":"ok"`, `"models_loaded":true`, `"mock":false`. (503 with `"degraded"`:
   the models did not load; read the logs. 502 or a spinner: it is still starting or waking, wait 30 s.)
2. Open `$URL/`: the amber **NOT FOR CLINICAL USE** banner is on top, the form is there, there is **no** "MOCK DATA"
   badge anywhere.
3. The 3D heart appears; the line under it reads `Lite model · WebGL` or `Full model · WebGL` (not `no WebGL`).
4. Click **Illustrative case C**, then **Predict risk**. Overall CAD shows **about 96 %** (accept 94 to 98) in the
   **High risk** band; measured: CAD 96, LAD 76, LCX 58, RCA 57 percent, the heart's three arteries turn red. A cold first
   prediction takes several seconds.
5. **About** tab: dataset attribution (CC BY 4.0, DOI) and the 3D heart credit (CC BY-SA 4.0), and the expandable
   `ASSETS_AND_LICENSES.md`.
6. `$URL/api/nope` is a JSON 404 (`{"error": ...}`), and `$URL/docs` opens the API documentation.
7. Optional, from a computer with the repository: `cd web && npm ci && PROD_URL=$URL node tests/e2e/prod.mjs` runs
   items 1 to 5 in headless Chromium (needs the Chromium that Playwright installed, see `docs/web.md`).

## 7. Licence and attribution, and what to put on Devpost

**The licence page is part of the app.** The 3D mesh is Z-Anatomy (BodyParts3D), CC BY-SA 4.0, so its credit has to be
visible wherever the app is shown. The About tab carries it, and reproduces `ASSETS_AND_LICENSES.md` in full. This was
checked in the production build (`web/tests/e2e/prod.mjs`, test 4: the tab shows the CC BY 4.0 dataset credit with its DOI,
the CC BY-SA 4.0 mesh credit and the expanded licence text mentioning Z-Anatomy). The licence files of the mesh are also
served as plain files, for example `$URL/models3d/LICENSE-models.md` and
`$URL/models3d/licence/svitylo-data-1.1.0-ATTRIBUTION.md`, and the Docker image ships `ASSETS_AND_LICENSES.md`. Keep the Hugging Face Space README's credits section when you edit it. This is project
documentation, not legal advice; the share-alike terms for the mesh are described in `ASSETS_AND_LICENSES.md`.

**Devpost "Try it out" links**, in this order:

1. Live app: `https://<your-service>.onrender.com` or `https://<your-user>-riskatlas.hf.space`. Say in the text that
   the free host may need up to a minute or two to wake, and that the app is a research prototype.
2. Source code: the GitHub repository (README, `docs/DEPLOY.md`).
3. API documentation: `<live app>/docs` (Swagger; the page loads its viewer from a CDN, so the *viewer's* browser needs
   internet for that page only).
4. Run it yourself: the repository's README plus `scripts/serve_prod.sh` / `scripts/serve_prod.ps1` (section 2).

If you do not deploy, list items 2 and 4 and the demo video, and say "runs locally" rather than linking a dead URL.

**Privacy.** The app has no database, cookies or accounts. Entered values live only in the API's in-memory cache until
the process restarts. Use the illustrative cases or made-up values on a public demo: it is not a medical device.

## 8. What was checked, and what was not

Prepared on a 4-core Linux VM with 16 GB RAM (shared with other work), Python 3.11.15, Node 22.

| Check | Result |
|---|---|
| `pip install -r requirements.txt` in a fresh Python 3.11 venv | OK, 72 s with a warm network; 1,460 MB on disk, 992 MB after removing nccl |
| Without nccl: import, start-up, full and fast predictions | OK; the case C answer is identical to the run with nccl (JSON compared exactly, timings excluded) |
| Web stage: `npm ci && npm run build` in a folder holding only what the Dockerfile copies (plus `ASSETS_AND_LICENSES.md` one level up) | OK; the build needs that file, which the Dockerfile copies in |
| Runtime stage: only `api/ pipeline/ config/ models/ reports/example_prediction.json ASSETS_AND_LICENSES.md web/dist`, started with the image's environment and command (`PORT`, `API_WARMUP=1`, `exec uvicorn ...`) | OK. No `data/`, `docs/` or other reports needed; nothing written into the application folder |
| Time from start to `/api/health` 200 | **18 to 21 s** cold (warm-up prediction 14 s of that) |
| Memory | **431 MiB** idle, **444 MiB** peak (`VmHWM`) during full predictions |
| Latency (4 cores) | full `/api/predict` about **5.7 s** (`docs/api.md` quotes 3.7 s on a quieter machine); same request again 6 ms (cache); `/api/predict/fast` 0.17 s; `/api/health` 6 ms |
| Pinned to 1 core (`taskset`) | start-up 18.9 s, full prediction 5.5 to 6.0 s: no benefit from extra cores |
| `tests/test_api_static.py` | 72 tests: root routes, `/api/*`, SPA fallback, JSON 404 under `/api`, 405 kept, MIME types (`.js`, `.css`, `.glb`), cache headers, 304, HEAD, ranges, gzip, path traversal (client and raw ASGI level, symlink), env switches, unchanged OpenAPI schema |
| Real server + `curl`/raw sockets | 13 traversal attempts (`../`, `%2e%2e`, `%2f`, `%5c`) never returned a file outside `web/dist` |
| Real Chromium (headless, software GL) against the production server, real models (`web/tests/e2e/prod.mjs`) | 5 of 5 pass: no MOCK banner, no console error, every request same-origin, `heart.glb` as `model/gltf-binary`, case C gives CAD 96 % with `Lite model · WebGL`, About tab licences, JSON 404 and cache headers |
| `scripts/serve_prod.sh` | run twice: without a suitable Python (clear message, exit 1), and with `web/dist` deleted (built it, started the server, `/api/health` 200) |
| Download weight | `web/dist` 1.8 MB: JS 1.0 MB raw, about 280 KB gzipped; `heart.glb` 561 KB, `heart_lite.glb` 202 KB |

**Not done, and why.**

- **No `docker build` or `docker run`.** The Docker CLI is installed but its daemon was not running, and starting one
  was not permitted in that sandbox. The `Dockerfile` was only checked for syntax with a parser (`dockerfile-parse`), and
  every `COPY` source was confirmed to exist. Each step was instead run natively as listed above. Untested because of that:
  the base images and their package sets, the `useradd` / non-root `USER` step (the app writes nothing into its folder, but it
  was not run as UID 1000), the `HEALTHCHECK`, how `.dockerignore` re-includes `reports/example_prediction.json`, and
  the final image size. Treat the first `docker build` as the real test.
- **`render.yaml` and the Hugging Face front matter** were not validated against the hosts (they are not reachable from
  the sandbox). Both have a manual fallback in sections 3 and 4.
- **`scripts/serve_prod.ps1`** was read, not run.
- **No deployment, no host account, no public URL.** Every host limit above is from the host, not from this machine.

## 9. Lines the main README should change

`README.md` was not edited here. Its "Not deployed", "Live demo" and "Production build" passages are now out of date, and
its environment table lacks the new variables. Suggested replacements:

- Live demo: `Not deployed yet. One process serves the web app and the API: see [docs/DEPLOY.md](docs/DEPLOY.md)
  (laptop script, Docker, Render, Hugging Face Spaces).`
- Production build: `cd web && npm run build` then `uvicorn api.main:app --port 8000` serves the web app and the API on
  one port (the API is also at `/api`). `scripts/serve_prod.sh` / `scripts/serve_prod.ps1` do both.
- Environment table, new rows: `SERVE_WEB` (API: `1` serve `web/dist`, `0` never; default: only if it exists for
  `uvicorn api.main:app`), `WEB_DIST` (API: folder of the built web app), `PORT` (hosts set it; the Docker image uses it).
- Replace the sentence "`.env.example` lists some of these under older names" with: "`.env.example` lists every variable
  with its default, commented out; nothing loads a `.env` file."
