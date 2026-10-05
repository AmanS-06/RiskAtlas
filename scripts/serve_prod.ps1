<#
.SYNOPSIS
  One-process demo for Windows: builds the web app if web\dist is missing, then serves the web app and the API together.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\serve_prod.ps1
  Serves http://127.0.0.1:8000. Ready about 15 to 20 s after the models have loaded.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\serve_prod.ps1 -Port 9000 -BindAddress 0.0.0.0 -Rebuild
  Another port, reachable from other devices on the network, web app rebuilt first.

.NOTES
  Needs the Python packages from requirements.txt (a .venv in the repo root is picked up; $env:PYTHON overrides) and,
  only when web\dist has to be built, Node 20.19+ or 22.12+. $env:PORT is honoured when -Port is not given.
  Docs: docs\DEPLOY.md.
#>
param(
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8000 }),
  [string]$BindAddress = $(if ($env:HOST) { $env:HOST } else { "127.0.0.1" }),
  [switch]$Rebuild
)

# Native commands do not throw in PowerShell, so every one is followed by an explicit exit-code check.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

# ---- Python -----------------------------------------------------------------------------------------------------
$py = $null
if ($env:PYTHON) { $py = $env:PYTHON }
elseif (Test-Path ".venv\Scripts\python.exe") { $py = ".venv\Scripts\python.exe" }
else {
  $found = Get-Command python -ErrorAction SilentlyContinue
  if ($found) { $py = $found.Source }
}
$check = "import importlib.util as u, sys; sys.exit(0 if all(u.find_spec(m) for m in ('uvicorn', 'fastapi', 'shap', 'xgboost')) else 1)"
$ready = $false
if ($py) {
  & $py -c $check 2>$null
  $ready = ($LASTEXITCODE -eq 0)
}
if (-not $ready) {
  Write-Host "Python with the project requirements not found (looked for .venv\Scripts\python.exe, then python)."
  Write-Host "Set it up once:  py -3.11 -m venv .venv ; .venv\Scripts\pip install -r requirements.txt"
  exit 1
}

# ---- web app ----------------------------------------------------------------------------------------------------
if ($Rebuild -or -not (Test-Path "web\dist\index.html")) {
  # npm.cmd, not npm: npm.ps1 is blocked on machines where running scripts is disabled.
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host "web\dist is missing and npm is not installed (Node 20.19+ or 22.12+ is needed to build it)."
    exit 1
  }
  Write-Host "Building the web app (web\dist) ..."
  Push-Location web
  if (-not (Test-Path "node_modules")) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
  }
  $env:VITE_API_BASE = "/api"
  & npm.cmd run build
  $buildExit = $LASTEXITCODE
  Pop-Location
  if ($buildExit -ne 0) { exit 1 }
}

# ---- serve ------------------------------------------------------------------------------------------------------
Write-Host "RiskAtlas on http://${BindAddress}:${Port}  (one process: web app + API under /api; ready in about 15 to 20 s)"
$env:SERVE_WEB = "1"
& $py -m uvicorn api.main:app --host $BindAddress --port $Port
exit $LASTEXITCODE
