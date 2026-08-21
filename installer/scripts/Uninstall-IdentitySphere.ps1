#Requires -RunAsAdministrator
param(
  [string]$InstallRoot = "",
  [string]$DataRoot = "",
  [switch]$RemoveBinaries,
  [switch]$RemoveDatabase,
  [switch]$RemoveLicense,
  [switch]$RemoveLogs,
  [switch]$RemoveConfig,
  [switch]$RemoveData
)

$ErrorActionPreference = "Continue"

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

# Always stop/unregister services; do NOT delete Program Files here (Inno owns file removal).
& "$PSScriptRoot\Stop-ADSecurityServices.ps1" -InstallRoot $InstallRoot

if ($RemoveBinaries -and (Test-Path $InstallRoot)) {
  Remove-Item -Recurse -Force $InstallRoot -ErrorAction SilentlyContinue
}

if ($RemoveData) {
  Remove-Item -Recurse -Force $DataRoot -ErrorAction SilentlyContinue
} else {
  if ($RemoveDatabase) {
    Remove-Item -Recurse -Force (Join-Path $DataRoot "mongodb") -ErrorAction SilentlyContinue
  }
  if ($RemoveLicense) {
    Remove-Item -Recurse -Force (Join-Path $DataRoot "license") -ErrorAction SilentlyContinue
  }
  if ($RemoveLogs) {
    Remove-Item -Recurse -Force (Join-Path $DataRoot "logs") -ErrorAction SilentlyContinue
  }
  if ($RemoveConfig) {
    Remove-Item -Recurse -Force (Join-Path $DataRoot "config") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $DataRoot "version.json") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $DataRoot "setup") -ErrorAction SilentlyContinue
  }
}

Remove-Item -Path "HKLM:\Software\Wisbility\ADSecurity" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Uninstall helper complete."
