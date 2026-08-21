#Requires -Version 5.1
<#
.SYNOPSIS
  Write payload-manifest.json for an already-staged installer payload.
  Safe to run repeatedly; does not rebuild or delete the payload.
#>
param(
  [string]$OutDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "installer\payload")
)

$ErrorActionPreference = "Stop"
$OutDir = (Resolve-Path $OutDir).Path
Write-Host "Payload: $OutDir"

if (-not (Test-Path $OutDir)) { throw "Payload folder not found: $OutDir" }

$manifestPath = Join-Path $OutDir "payload-manifest.json"
$hasher = [System.Security.Cryptography.SHA256]::Create()

$all = Get-ChildItem -Path $OutDir -Recurse -File | Where-Object { $_.Name -ne "payload-manifest.json" }
$total = $all.Count
Write-Host "Hashing $total files (this can take a few minutes)…"

$i = 0
$files = foreach ($f in $all) {
  $i++
  if ($i % 250 -eq 0) { Write-Host ("  {0}/{1}" -f $i, $total) }
  $stream = [System.IO.File]::OpenRead($f.FullName)
  try {
    $hashBytes = $hasher.ComputeHash($stream)
  } finally {
    $stream.Dispose()
  }
  $hash = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""
  [PSCustomObject]@{
    path   = $f.FullName.Substring($OutDir.Length).TrimStart('\', '/')
    sha256 = $hash
    size   = $f.Length
  }
}

$manifestHashInput = ($files | Sort-Object path | ForEach-Object { $_.path + ":" + $_.sha256 }) -join "`n"
$manifestSha = ($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifestHashInput)) | ForEach-Object { $_.ToString("x2") }) -join ""

$gitCommit = ""
$gitBranch = ""
try { $gitCommit = (git rev-parse HEAD).Trim() } catch {}
try { $gitBranch = (git rev-parse --abbrev-ref HEAD).Trim() } catch {}

@{
  productVersion = "1.0.0"
  schemaVersion  = 1
  nodeVersion    = (node -v)
  mongoVersion   = "8.x"
  sha256         = $manifestSha
  createdAt      = (Get-Date).ToUniversalTime().ToString("o")
  gitCommit      = $gitCommit
  branch         = $gitBranch
  buildMachine   = $env:COMPUTERNAME
  files          = $files
} | ConvertTo-Json -Depth 6 | Set-Content $manifestPath -Encoding UTF8

if (Test-Path $manifestPath) {
  Write-Host ""
  Write-Host "OK - wrote $manifestPath" -ForegroundColor Green
  Write-Host "Manifest sha256: $manifestSha"
} else {
  throw "Failed to write $manifestPath"
}
