#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Export ProgramData bundle for moving Identity Sphere to a new host.
#>
param(
  [ValidateSet("export", "import")]
  [string]$Action = "export",
  [string]$DataRoot = "C:\ProgramData\ADSecurity",
  [string]$BundlePath = "",
  [string]$NewDataRoot = "C:\ProgramData\ADSecurity"
)

$ErrorActionPreference = "Stop"

if ($Action -eq "export") {
  if (-not $BundlePath) {
    $BundlePath = Join-Path $DataRoot ("backups\move-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $BundlePath) | Out-Null
  $stage = Join-Path $env:TEMP ("is-move-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Copy-Item (Join-Path $DataRoot "config") (Join-Path $stage "config") -Recurse -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $DataRoot "license") (Join-Path $stage "license") -Recurse -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $DataRoot "version.json") (Join-Path $stage "version.json") -ErrorAction SilentlyContinue
  Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $BundlePath -Force
  Remove-Item -Recurse -Force $stage
  Write-Host "Exported move bundle (config/license/version). Run Backup-Restore for database separately."
  Write-Host "Bundle: $BundlePath"
  exit 0
}

if (-not $BundlePath -or -not (Test-Path $BundlePath)) { throw "BundlePath required for import" }
$stage = Join-Path $env:TEMP ("is-import-" + [guid]::NewGuid().ToString("n"))
Expand-Archive -Path $BundlePath -DestinationPath $stage -Force
New-Item -ItemType Directory -Force -Path $NewDataRoot | Out-Null
Copy-Item (Join-Path $stage "*") $NewDataRoot -Recurse -Force

$configPath = Join-Path $NewDataRoot "config\config.json"
if (Test-Path $configPath) {
  $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
  $cfg.paths.uploads = Join-Path $NewDataRoot "uploads"
  $cfg.paths.license = Join-Path $NewDataRoot "license\license.lic.json"
  $cfg.paths.logs = Join-Path $NewDataRoot "logs"
  $cfg.paths.backups = Join-Path $NewDataRoot "backups"
  $cfg.paths.data = $NewDataRoot
  $cfg | ConvertTo-Json -Depth 8 | Set-Content $configPath -Encoding UTF8
}

Remove-Item -Recurse -Force $stage
Write-Host "Imported ProgramData bundle into $NewDataRoot (paths rewritten). Restore DB next."
