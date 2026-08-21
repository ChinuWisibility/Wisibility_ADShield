param(
  [string]$DataRoot = "",
  [string]$InstallRoot = ""
)

# Do not use Stop globally - ProgramData\config may be ACL-restricted to Administrators.
$ErrorActionPreference = "Continue"

$port = 8081

# Prefer registry (readable without admin) for InstallRoot / DataRoot / Port
try {
  $reg = Get-ItemProperty -Path "HKLM:\Software\Wisbility\ADSecurity" -ErrorAction Stop
  if (-not $InstallRoot -and $reg.InstallRoot) { $InstallRoot = [string]$reg.InstallRoot }
  if (-not $DataRoot -and $reg.DataRoot) { $DataRoot = [string]$reg.DataRoot }
  if ($reg.Port) { $port = [int]$reg.Port }
} catch {}

if (-not $InstallRoot) { $InstallRoot = "C:\Program Files\ADSecurity" }
if (-not $DataRoot) { $DataRoot = "C:\ProgramData\ADSecurity" }

# Optional config override - ignore Access Denied on restricted ProgramData folders
try {
  $configPath = Join-Path $DataRoot "config\config.json"
  if (Test-Path -LiteralPath $configPath -ErrorAction SilentlyContinue) {
    $cfg = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json
    if ($cfg.server.port) { $port = [int]$cfg.server.port }
  }
} catch {
  # Keep registry/default port
}

# Ensure services are running (best-effort; may need elevation for start)
$winsw = Join-Path $InstallRoot "runtime\winsw"
if (Test-Path -LiteralPath $winsw) {
  Push-Location $winsw
  try { & ".\ADSecurity.Mongo.exe" start 2>&1 | Out-Null } catch {}
  try { & ".\ADSecurity.API.exe" start 2>&1 | Out-Null } catch {}
  Pop-Location
  Start-Sleep -Seconds 2
}

Start-Process "http://127.0.0.1:$port/"
