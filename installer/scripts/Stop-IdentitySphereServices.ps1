#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stop and unregister ADSecurity WinSW services without deleting Program Files.
#>
param(
  [Parameter(Mandatory = $false)]
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Continue"

if (-not $InstallRoot) {
  try {
    $InstallRoot = (Get-ItemProperty -Path "HKLM:\Software\Wisbility\ADSecurity" -ErrorAction Stop).InstallRoot
  } catch {
    $InstallRoot = "C:\Program Files\ADSecurity"
  }
}

$winsw = Join-Path $InstallRoot "runtime\winsw"
if (-not (Test-Path $winsw)) {
  Write-Host "WinSW folder not found under $InstallRoot - nothing to stop"
  exit 0
}

Push-Location $winsw
try { & ".\ADSecurity.API.exe" stop } catch {}
try { & ".\ADSecurity.Mongo.exe" stop } catch {}
Start-Sleep -Seconds 2
try { & ".\ADSecurity.API.exe" uninstall } catch {}
try { & ".\ADSecurity.Mongo.exe" uninstall } catch {}
Pop-Location

Write-Host "ADSecurity services stopped and unregistered."
