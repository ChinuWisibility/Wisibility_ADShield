<#
.SYNOPSIS
  Identity Sphere doctor — collect support diagnostics on the host.
#>
param(
  [string]$DataRoot = "C:\ProgramData\ADSecurity",
  [string]$InstallRoot = "C:\Program Files\ADSecurity",
  [string]$OutFile = ""
)

$ErrorActionPreference = "Continue"
if (-not $OutFile) {
  $OutFile = Join-Path $DataRoot ("logs\runtime\doctor-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".json")
}

$report = [ordered]@{
  collectedAt = (Get-Date).ToUniversalTime().ToString("o")
  product = @{ company = "Wisbility"; name = "Identity Sphere"; servicePrefix = "ADSecurity" }
  installRoot = $InstallRoot
  dataRoot = $DataRoot
  version = $null
  configExists = Test-Path (Join-Path $DataRoot "config\config.json")
  licenseExists = Test-Path (Join-Path $DataRoot "license\license.lic.json")
  services = @{}
  ports = @{}
  recentLogs = @{}
}

if (Test-Path (Join-Path $DataRoot "version.json")) {
  $report.version = Get-Content (Join-Path $DataRoot "version.json") -Raw | ConvertFrom-Json
}

foreach ($svc in @("ADSecurity.API", "ADSecurity.Mongo")) {
  try {
    $s = Get-Service -Name $svc -ErrorAction Stop
    $report.services[$svc] = @{ status = "$($s.Status)"; startType = "$($s.StartType)" }
  } catch {
    $report.services[$svc] = @{ status = "missing"; error = $_.Exception.Message }
  }
}

$port = 8081
try {
  $cfg = Get-Content (Join-Path $DataRoot "config\config.json") -Raw | ConvertFrom-Json
  $port = [int]$cfg.server.port
} catch {}

foreach ($p in @($port, 27017)) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $p)
    $tcp.Close()
    $report.ports["$p"] = "open"
  } catch {
    $report.ports["$p"] = "closed"
  }
}

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5
  $report.health = @{ statusCode = $r.StatusCode; body = $r.Content }
} catch {
  $report.health = @{ error = $_.Exception.Message }
}

try {
  $d = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/system/info" -UseBasicParsing -TimeoutSec 5
  $report.systemInfo = $d.Content
} catch {}

New-Item -ItemType Directory -Force -Path (Split-Path $OutFile) | Out-Null
($report | ConvertTo-Json -Depth 8) | Set-Content $OutFile -Encoding UTF8
Write-Host "Doctor report written to $OutFile"
