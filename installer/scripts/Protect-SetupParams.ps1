#Requires -RunAsAdministrator
<#
.SYNOPSIS
  DPAPI-protect a plaintext setup JSON file (LocalMachine scope) and delete the plaintext source.
.PARAMETER InPath
  Path to plaintext JSON (deleted on success).
.PARAMETER OutPath
  Path for encrypted blob.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$InPath,

  [Parameter(Mandatory = $true)]
  [string]$OutPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

if (-not (Test-Path -LiteralPath $InPath)) {
  throw "Setup params file not found: $InPath"
}

$plain = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InPath).Path)
try {
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $plain,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $outDir = Split-Path -Parent $OutPath
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }
  [System.IO.File]::WriteAllBytes($OutPath, $protected)
}
finally {
  # Scrub and delete plaintext immediately
  for ($i = 0; $i -lt $plain.Length; $i++) { $plain[$i] = 0 }
  Remove-Item -LiteralPath $InPath -Force -ErrorAction SilentlyContinue
}

Write-Output $OutPath
