#Requires -Version 5.1
<#
.SYNOPSIS
  Build offline installer payload on a Windows agent (prebuilt node_modules).

.DESCRIPTION
  Uses the monorepo root for builds (npm workspaces). Avoids `npm ci` by default
  because Windows often locks esbuild.exe (EPERM unlink). Stages a fresh
  production-only backend node_modules into the payload folder.

.PARAMETER SkipNpmInstall
  Reuse existing root node_modules (skip install). Use when deps are already present.

.PARAMETER ForceCleanInstall
  Delete root node_modules and package-lock-driven reinstall (more likely to hit EPERM).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\prepare-payload.ps1

.EXAMPLE
  # After a previous EPERM failure - close IDEs/dev servers, then:
  powershell -ExecutionPolicy Bypass -File .\scripts\windows\prepare-payload.ps1 -SkipNpmInstall
#>
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OutDir = "",
  [switch]$SkipNpmInstall,
  [switch]$ForceCleanInstall
)

$ErrorActionPreference = "Stop"
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "installer\payload" }

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host ("==> " + $msg) -ForegroundColor Cyan
}

function Stop-LockingNodeProcesses {
  # Best-effort: release locks on esbuild.exe / vite held by leftover node processes.
  Get-Process -Name "node","esbuild" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Write-Host ("Stopping process {0} (pid {1}) that may lock build tools..." -f $_.ProcessName, $_.Id)
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  Start-Sleep -Seconds 1
}

function Invoke-NpmInstallRobust {
  param([string]$WorkingDirectory, [string[]]$NpmArgs)

  Push-Location $WorkingDirectory
  try {
    Write-Host ("npm " + ($NpmArgs -join " "))
    & npm @NpmArgs
    if ($LASTEXITCODE -eq 0) { return }

    Write-Host "npm failed (exit $LASTEXITCODE). Retrying after releasing file locks..." -ForegroundColor Yellow
    Stop-LockingNodeProcesses

    # Prefer install over ci on Windows - ci deletes node_modules and hits EPERM on esbuild.exe
    $fallback = @("install") + ($NpmArgs | Where-Object { $_ -notin @("ci", "install") })
    if ($NpmArgs -contains "ci") {
      Write-Host ("Falling back to: npm " + ($fallback -join " ")) -ForegroundColor Yellow
      & npm @fallback
      if ($LASTEXITCODE -eq 0) { return }
    }

    throw @"
npm install failed with exit code $LASTEXITCODE.

Windows EPERM on esbuild.exe usually means the file is locked. Try:

  1. Close Cursor/VS Code terminals running 'npm run dev' / Vite
  2. Close any other Node processes (Task Manager -> end node.exe)
  3. Temporarily pause antivirus real-time scan on the repo folder
  4. Re-run:  .\scripts\windows\prepare-payload.ps1 -SkipNpmInstall
     (if node_modules is already usable), or open an elevated PowerShell and retry
"@
  }
  finally {
    Pop-Location
  }
}

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found on PATH: $Name"
  }
}

Write-Host "Repo: $RepoRoot"
Write-Host "Out:  $OutDir"

Assert-Command "node"
Assert-Command "npm"

$backend = Join-Path $RepoRoot "icm-backend"
$frontend = Join-Path $RepoRoot "icm-frontend"
$rootModules = Join-Path $RepoRoot "node_modules"
$viteJs = Join-Path $rootModules "vite\bin\vite.js"

# Clean stage only (never delete root node_modules unless ForceCleanInstall)
Write-Step "Preparing payload directory"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "app\backend") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "app\frontend") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "app\keys") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "runtime") | Out-Null

# --- Root workspace install (needed for Vite / build tooling) ---
if ($ForceCleanInstall) {
  Write-Step "Force-clean root node_modules"
  Stop-LockingNodeProcesses
  if (Test-Path $rootModules) {
    try {
      Remove-Item -Recurse -Force $rootModules
    } catch {
      throw "Could not delete node_modules (file lock). Close Node/Vite/IDE terminals and retry. $_"
    }
  }
}

if (-not $SkipNpmInstall) {
  Write-Step "Installing monorepo dependencies (npm install - avoids npm ci EPERM on Windows)"
  # Workspaces hoist packages to repo root; do NOT run npm ci inside workspace folders.
  Invoke-NpmInstallRobust -WorkingDirectory $RepoRoot -NpmArgs @("install")
} else {
  Write-Step "Skipping npm install (-SkipNpmInstall)"
  if (-not (Test-Path $rootModules)) {
    throw "node_modules missing at $rootModules - re-run without -SkipNpmInstall"
  }
}

if (-not (Test-Path $viteJs)) {
  throw @"
Vite is not installed at:
  $viteJs

Frontend build cannot continue. From the repo root run:
  npm install

Then re-run this script (optionally with -SkipNpmInstall).
"@
}

# --- Build backend dist ---
Write-Step "Building backend dist/"
Push-Location $backend
try {
  & npm run build:dist
  if ($LASTEXITCODE -ne 0) { throw "backend build:dist failed with exit $LASTEXITCODE" }
}
finally {
  Pop-Location
}

# --- Build frontend (invoke vite via node - do not rely on PATH shims) ---
Write-Step "Building frontend (VITE_API_BASE_URL=/api)"
$env:VITE_API_BASE_URL = "/api"
Push-Location $frontend
try {
  & node $viteJs build
  if ($LASTEXITCODE -ne 0) { throw "frontend vite build failed with exit $LASTEXITCODE" }
}
finally {
  Pop-Location
}

$frontendDist = Join-Path $frontend "dist"
if (-not (Test-Path (Join-Path $frontendDist "index.html"))) {
  throw "Frontend build did not produce dist/index.html"
}

# --- Stage application files ---
Write-Step "Staging backend dist, migrations, package.json"
Copy-Item (Join-Path $backend "dist") (Join-Path $OutDir "app\backend\dist") -Recurse -Force
Copy-Item (Join-Path $backend "migrations") (Join-Path $OutDir "app\backend\migrations") -Recurse -Force
Copy-Item (Join-Path $backend "package.json") (Join-Path $OutDir "app\backend\package.json") -Force

# Production-only backend node_modules inside the payload (self-contained; not the monorepo hoist)
Write-Step "Installing production backend node_modules into payload (omit=dev)"
$payloadBackend = Join-Path $OutDir "app\backend"
Push-Location $payloadBackend
try {
  # Isolated install - does not mutate the locked monorepo esbuild binary
  & npm install --omit=dev --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) {
    throw "payload backend npm install --omit=dev failed with exit $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

Write-Step "Staging frontend dist"
Copy-Item (Join-Path $frontendDist "*") (Join-Path $OutDir "app\frontend") -Recurse -Force

# Public keys only
Write-Step "Staging public license keys"
$keysSrc = Join-Path $backend "keys"
if (Test-Path $keysSrc) {
  Get-ChildItem $keysSrc -Directory | ForEach-Object {
    $pub = Join-Path $_.FullName "public.pem"
    if (Test-Path $pub) {
      $dest = Join-Path $OutDir ("app\keys\" + $_.Name)
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      Copy-Item $pub (Join-Path $dest "public.pem") -Force
    }
  }
}

# Copy runtime binaries if present in installer/runtime
Write-Step "Staging runtime binaries (if present)"
$runtimeSrc = Join-Path $RepoRoot "installer\runtime"
if (Test-Path $runtimeSrc) {
  Copy-Item "$runtimeSrc\*" (Join-Path $OutDir "runtime") -Recurse -Force -ErrorAction SilentlyContinue
}

$requiredRuntime = @(
  (Join-Path $OutDir "runtime\winsw\ADSecurity.API.exe"),
  (Join-Path $OutDir "runtime\winsw\ADSecurity.Mongo.exe"),
  (Join-Path $OutDir "runtime\node\node.exe"),
  (Join-Path $OutDir "runtime\mongodb\bin\mongod.exe")
)
$missingRuntime = @($requiredRuntime | Where-Object { -not (Test-Path $_) })
if ($missingRuntime.Count -gt 0) {
  throw @"
Payload is missing required runtime binaries:
  $($missingRuntime -join "`r`n  ")

Run first:
  powershell -ExecutionPolicy Bypass -File .\installer\scripts\Fetch-RuntimeBinaries.ps1

Then re-run prepare-payload.ps1.
"@
}

# Manifest
Write-Step "Writing payload-manifest.json"
$gitCommit = ""
$gitBranch = ""
try { $gitCommit = (git -C $RepoRoot rev-parse HEAD).Trim() } catch {}
try { $gitBranch = (git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim() } catch {}

$hasher = [System.Security.Cryptography.SHA256]::Create()
$files = Get-ChildItem -Path $OutDir -Recurse -File | ForEach-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
  $hash = ($hasher.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join ""
  [PSCustomObject]@{
    path = $_.FullName.Substring($OutDir.Length).TrimStart('\', '/')
    sha256 = $hash
    size = $_.Length
  }
}
$manifestHashInput = ($files | Sort-Object path | ForEach-Object { $_.path + ":" + $_.sha256 }) -join "`n"
$manifestSha = ($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifestHashInput)) | ForEach-Object { $_.ToString("x2") }) -join ""

$manifest = @{
  productVersion = "1.0.0"
  schemaVersion = 1
  nodeVersion = (node -v)
  mongoVersion = "8.x"
  sha256 = $manifestSha
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  gitCommit = $gitCommit
  branch = $gitBranch
  buildMachine = $env:COMPUTERNAME
  files = $files
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutDir "payload-manifest.json") -Encoding UTF8

Write-Host ""
Write-Host "Payload ready: $OutDir" -ForegroundColor Green
Write-Host "Manifest sha256: $manifestSha"
