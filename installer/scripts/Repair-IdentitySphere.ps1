#Requires -RunAsAdministrator
param(
  [string]$InstallRoot = "",
  [string]$DataRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallRoot) {
  try {
    $InstallRoot = (Get-ItemProperty -Path "HKLM:\Software\Wisbility\ADSecurity" -ErrorAction Stop).InstallRoot
  } catch {
    $InstallRoot = "C:\Program Files\ADSecurity"
  }
}
if (-not $DataRoot) {
  try {
    $DataRoot = (Get-ItemProperty -Path "HKLM:\Software\Wisbility\ADSecurity" -ErrorAction Stop).DataRoot
  } catch {
    $DataRoot = "C:\ProgramData\ADSecurity"
  }
}

$winsw = Join-Path $InstallRoot "runtime\winsw"

Write-Host "Repairing Identity Sphere installation..."

# Recreate ProgramData folders (never delete license/config/mongodb contents)
$dirs = @(
  "config", "license", "setup", "uploads", "mongodb", "backups", "cache",
  "logs\api", "logs\mongo", "logs\connector", "logs\installer", "logs\runtime", "logs\updater"
)
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot $d) | Out-Null
}

# Re-register services if missing (binaries only - no admin/license re-prompt)
Push-Location $winsw
try { & ".\ADSecurity.Mongo.exe" status } catch { & ".\ADSecurity.Mongo.exe" install }
try { & ".\ADSecurity.API.exe" status } catch { & ".\ADSecurity.API.exe" install }
& ".\ADSecurity.Mongo.exe" start
Start-Sleep -Seconds 3
& ".\ADSecurity.API.exe" start
Pop-Location

# Registry
$reg = "HKLM:\Software\Wisbility\ADSecurity"
New-Item -Path $reg -Force | Out-Null
New-ItemProperty -Path $reg -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
New-ItemProperty -Path $reg -Name DataRoot -Value $DataRoot -PropertyType String -Force | Out-Null

Write-Host "Repair complete."
