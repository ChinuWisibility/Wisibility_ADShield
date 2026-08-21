#Requires -Version 5.1
<#
.SYNOPSIS
  Download WinSW, Node.js, and MongoDB Community binaries into installer\runtime.

.DESCRIPTION
  These are not committed to git. prepare-payload.ps1 copies installer\runtime into the payload.
  Run this once on a Windows build agent before compiling ADSecurity.iss.
#>
param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$NodeVersion = "22.18.0",
  [string]$MongoVersion = "8.0.12",
  [string]$WinSWVersion = "2.12.0"
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Join-Path $RepoRoot "installer\runtime"
$cache = Join-Path $RepoRoot "installer\.runtime-cache"
New-Item -ItemType Directory -Force -Path $cache | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot "winsw") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot "node") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot "mongodb") | Out-Null

function Write-Step($m) { Write-Host ""; Write-Host ("==> " + $m) -ForegroundColor Cyan }

function Get-RemoteFile([string]$Url, [string]$OutFile) {
  if (Test-Path $OutFile) {
    Write-Host ("Cached: " + $OutFile)
    return
  }
  Write-Host ("Downloading: " + $Url)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

# --- WinSW ---
Write-Step "WinSW $WinSWVersion"
$winswZipOrExe = Join-Path $cache ("WinSW-x64-$WinSWVersion.exe")
$winswUrl = "https://github.com/winsw/winsw/releases/download/v$WinSWVersion/WinSW-x64.exe"
Get-RemoteFile $winswUrl $winswZipOrExe
Copy-Item $winswZipOrExe (Join-Path $runtimeRoot "winsw\ADSecurity.API.exe") -Force
Copy-Item $winswZipOrExe (Join-Path $runtimeRoot "winsw\ADSecurity.Mongo.exe") -Force
Write-Host "WinSW copied as ADSecurity.API.exe and ADSecurity.Mongo.exe"

# --- Node ---
Write-Step "Node.js $NodeVersion (win-x64)"
$nodeZip = Join-Path $cache ("node-v$NodeVersion-win-x64.zip")
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
Get-RemoteFile $nodeUrl $nodeZip
$nodeExtract = Join-Path $cache ("node-v$NodeVersion-win-x64")
if (Test-Path $nodeExtract) { Remove-Item $nodeExtract -Recurse -Force }
Expand-Archive -Path $nodeZip -DestinationPath $cache -Force
$nodeSrc = Join-Path $cache ("node-v$NodeVersion-win-x64")
$nodeDest = Join-Path $runtimeRoot "node"
Get-ChildItem $nodeDest -Force | Where-Object { $_.Name -notin @(".gitkeep","README.md") } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $nodeSrc "*") $nodeDest -Recurse -Force
if (-not (Test-Path (Join-Path $nodeDest "node.exe"))) {
  throw "node.exe missing after extract"
}
Write-Host ("Node ready: " + (Join-Path $nodeDest "node.exe"))

# --- MongoDB ---
Write-Step "MongoDB Community $MongoVersion (windows-x86_64)"
# Prefer zip from MongoDB community downloads CDN
$mongoZipName = "mongodb-windows-x86_64-$MongoVersion.zip"
$mongoZip = Join-Path $cache $mongoZipName
$mongoUrls = @(
  "https://fastdl.mongodb.org/windows/$mongoZipName",
  "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$MongoVersion-signed.zip"
)
$gotMongo = $false
foreach ($u in $mongoUrls) {
  try {
    Get-RemoteFile $u $mongoZip
    $gotMongo = $true
    break
  } catch {
    Write-Host ("Mongo download failed from $u : " + $_.Exception.Message) -ForegroundColor Yellow
    Remove-Item $mongoZip -Force -ErrorAction SilentlyContinue
  }
}
if (-not $gotMongo) {
  throw "Could not download MongoDB $MongoVersion. Place mongod.exe under installer\runtime\mongodb\bin manually."
}

$mongoExtractRoot = Join-Path $cache "mongo-extract"
if (Test-Path $mongoExtractRoot) { Remove-Item $mongoExtractRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $mongoExtractRoot | Out-Null
Expand-Archive -Path $mongoZip -DestinationPath $mongoExtractRoot -Force
$mongoSrc = Get-ChildItem $mongoExtractRoot -Directory | Select-Object -First 1
if (-not $mongoSrc) { throw "Mongo zip did not contain a top-level folder" }

$mongoDest = Join-Path $runtimeRoot "mongodb"
Get-ChildItem $mongoDest -Force | Where-Object { $_.Name -notin @(".gitkeep","README.md") } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
# Keep bin tools; copy full tree then ensure bin\mongod.exe
Copy-Item (Join-Path $mongoSrc.FullName "*") $mongoDest -Recurse -Force
if (-not (Test-Path (Join-Path $mongoDest "bin\mongod.exe"))) {
  # some packs nest under another folder
  $found = Get-ChildItem $mongoDest -Recurse -Filter mongod.exe | Select-Object -First 1
  if ($found) {
    $binSrc = $found.Directory.FullName
    New-Item -ItemType Directory -Force -Path (Join-Path $mongoDest "bin") | Out-Null
    Copy-Item (Join-Path $binSrc "*") (Join-Path $mongoDest "bin") -Force
  }
}
if (-not (Test-Path (Join-Path $mongoDest "bin\mongod.exe"))) {
  throw "mongod.exe missing after extract"
}
# Drop debug symbols - not needed in installer payload and are huge
Get-ChildItem (Join-Path $mongoDest "bin") -Filter "*.pdb" -ErrorAction SilentlyContinue | Remove-Item -Force
Write-Host ("Mongo ready: " + (Join-Path $mongoDest "bin\mongod.exe"))

# Optional VC++ redist placeholder note
$vc = Join-Path $mongoDest "bin\vc_redist.x64.exe"
if (-not (Test-Path $vc)) {
  Write-Host "Note: vc_redist.x64.exe not bundled; Configure will use system VC++ if present." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Runtime binaries ready under: $runtimeRoot" -ForegroundColor Green
Write-Host "Next: prepare-payload.ps1 (or copy runtime into payload), then recompile ADSecurity.iss"
