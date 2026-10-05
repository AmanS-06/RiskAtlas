# web-legacy

The first version of the RiskAtlas web app (dashboard and 3D viewer), kept unchanged with its tests as a safe
reference. It is also the git tag `legacy-ui-v1` (commit `229f82c`). The current UI lives in `web/`.

Run it separately: `cd web-legacy && npm ci && npm run dev` (needs the API on :8000, or open `/?mock=1`).
Tests: `npm test` (193 unit and component tests pass).
