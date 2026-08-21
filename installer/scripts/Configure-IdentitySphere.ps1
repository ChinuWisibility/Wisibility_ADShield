#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory = $false)]
  [string]$InstallRoot = "C:\Program Files\ADSecurity",

  [Parameter(Mandatory = $false)]
  [string]$DataRoot = "C:\ProgramData\ADSecurity",

  [Parameter(Mandatory = $false)]
  [int]$Port = 8081,

  [Parameter(Mandatory = $false)]
  [int]$MongoPort = 27017,

  # Path to DPAPI-encrypted setup blob (or plaintext JSON for legacy/dev). Optional.
  [Parameter(Mandatory = $false)]
  [string]$SetupFile = "",

  # fresh | upgrade | repair
  [Parameter(Mandatory = $false)]
  [string]$Mode = "fresh"
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $DataRoot "logs\installer"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("install-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
$progressPath = Join-Path $logDir "progress.json"
$script:SetupSecrets = $null

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $msg
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

function Write-ProgressStep {
  param(
    [string]$Step,
    [string]$Message,
    [int]$Percent,
    [string]$ErrorMessage = $null
  )
  $obj = @{
    step = $Step
    message = $Message
    percent = $Percent
    error = $ErrorMessage
    updatedAt = (Get-Date).ToString("o")
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($progressPath, (($obj | ConvertTo-Json -Compress) + "`r`n"), $utf8NoBom)
  Write-Log $Message
}

function Test-PortInUse([int]$p) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
    $listener.Start()
    $listener.Stop()
    return $false
  } catch {
    return $true
  }
}

function Set-RestrictedAcl([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $admins = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "BUILTIN\Administrators", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
  $system = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "NT AUTHORITY\SYSTEM", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
  $acl.AddAccessRule($admins)
  $acl.AddAccessRule($system)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-HiddenSystem([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  $item.Attributes = $item.Attributes -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System
}

function Read-SetupFile([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  Add-Type -AssemblyName System.Security
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path).Path)
  $text = $null
  # Try DPAPI first; fall back to UTF-8 JSON for test/legacy plaintext
  try {
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $bytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    $text = [System.Text.Encoding]::UTF8.GetString($plain)
    for ($i = 0; $i -lt $plain.Length; $i++) { $plain[$i] = 0 }
  } catch {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  }
  $json = $text | ConvertFrom-Json
  # Scrub string copy
  $text = $null
  return $json
}

function Remove-SetupFileSafe([string]$Path) {
  if ($Path -and (Test-Path -LiteralPath $Path)) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Rollback-Install {
  Write-Log "ROLLBACK: stopping and unregistering services"
  try { & "$InstallRoot\runtime\winsw\ADSecurity.API.exe" stop } catch {}
  try { & "$InstallRoot\runtime\winsw\ADSecurity.Mongo.exe" stop } catch {}
  Start-Sleep -Seconds 2
  try { & "$InstallRoot\runtime\winsw\ADSecurity.API.exe" uninstall } catch {}
  try { & "$InstallRoot\runtime\winsw\ADSecurity.Mongo.exe" uninstall } catch {}
  Write-Log "ROLLBACK: services unregistered (Program Files and ProgramData retained for retry)"
}

function Wait-ApiFullyReady([int]$ApiPort, [int]$TimeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
        $body = $r.Content | ConvertFrom-Json
        $data = $body.data
        if ($data.databaseReady -eq $true -and $data.backgroundInitComplete -eq $true) {
          return $true
        }
        # Accept healthy status even if older API without flags
        if ($data.status -eq "healthy") {
          return $true
        }
      }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

function Invoke-SetupInitialize {
  param(
    [int]$ApiPort,
    [string]$LicenseDest,
    [psobject]$Secrets
  )

  $setupDir = Join-Path $DataRoot "setup"
  New-Item -ItemType Directory -Force -Path $setupDir | Out-Null
  Set-RestrictedAcl $setupDir

  # Create one-time setup token via writing expected shape (backend also has create API unused from PS)
  $tokenBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
  $tokenHex = ($tokenBytes | ForEach-Object { $_.ToString("x2") }) -join ""
  $issued = Get-Date
  $expires = $issued.AddMinutes(10)
  $tokenObj = @{
    token = $tokenHex
    issuedAt = $issued.ToString("o")
    expiresAt = $expires.ToString("o")
  }
  $tokenPath = Join-Path $setupDir "setup.token"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tokenPath, (($tokenObj | ConvertTo-Json -Compress) + "`r`n"), $utf8NoBom)
  Set-RestrictedAcl $setupDir

  $bodyObj = @{
    admin = @{
      name = [string]$Secrets.name
      email = [string]$Secrets.email
      phone = $(if ($Secrets.phone) { [string]$Secrets.phone } else { "" })
      password = [string]$Secrets.password
    }
    licensePath = $LicenseDest
  }
  $bodyJson = $bodyObj | ConvertTo-Json -Depth 5 -Compress

  Write-ProgressStep -Step "create_admin" -Message "Creating Administrator..." -Percent 70

  $headers = @{
    "Content-Type" = "application/json"
    "X-ADSecurity-Setup-Token" = $tokenHex
  }

  try {
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/setup/initialize" `
      -Method POST -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8" `
      -UseBasicParsing -TimeoutSec 120
    if ($resp.StatusCode -lt 200 -or $resp.StatusCode -ge 300) {
      throw "initialize returned HTTP $($resp.StatusCode)"
    }
  } catch {
    $detail = $_.Exception.Message
    try {
      if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $detail = $reader.ReadToEnd()
      }
    } catch {}
    # Never log password; strip if present
    $safe = ($detail -replace [regex]::Escape([string]$Secrets.password), "***")
    throw "Setup initialize failed: $safe"
  } finally {
    $bodyJson = $null
    $bodyObj = $null
    $bodyBytes = $null
    $tokenHex = $null
  }

  Write-ProgressStep -Step "verify_license" -Message "Verifying License..." -Percent 90
  $statusResp = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/license/status" -UseBasicParsing -TimeoutSec 15
  $status = ($statusResp.Content | ConvertFrom-Json).data
  if (-not $status.licensed) {
    throw "License verification failed after initialize (licensed=false)"
  }
}

try {
  Write-Log "Starting Identity Sphere post-install configuration (mode=$Mode)"
  Write-ProgressStep -Step "start" -Message "Starting configuration..." -Percent 5

  if ($SetupFile) {
    $script:SetupSecrets = Read-SetupFile $SetupFile
    if (-not $script:SetupSecrets) {
      throw "Could not read setup file"
    }
    if (-not $script:SetupSecrets.email -or -not $script:SetupSecrets.password) {
      throw "Setup file is missing required admin fields"
    }
    Write-Log "Setup file loaded (credentials not logged)"
  }

  # Port conflict detection
  $chosen = $Port
  if (Test-PortInUse $chosen) {
    for ($i = $Port + 1; $i -lt $Port + 50; $i++) {
      if (-not (Test-PortInUse $i)) { $chosen = $i; break }
    }
    Write-Log "Port $Port in use - selected $chosen"
  }

  # ProgramData tree
  $dirs = @(
    "config", "license", "setup", "uploads", "mongodb", "backups", "cache",
    "logs\api", "logs\mongo", "logs\connector", "logs\installer", "logs\runtime", "logs\updater"
  )
  foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot $d) | Out-Null
  }

  Set-RestrictedAcl (Join-Path $DataRoot "license")
  Set-RestrictedAcl (Join-Path $DataRoot "setup")
  Set-RestrictedAcl (Join-Path $DataRoot "config")
  Set-HiddenSystem (Join-Path $DataRoot "license")

  $configPath = Join-Path $DataRoot "config\config.json"
  $setupMode = [bool]$script:SetupSecrets
  $forceReset = -not $setupMode

  if (-not (Test-Path $configPath)) {
    $cfg = @{
      server = @{ port = $chosen; host = "0.0.0.0" }
      database = @{ uri = "mongodb://127.0.0.1:$MongoPort"; name = "IGA-V3" }
      paths = @{
        uploads = (Join-Path $DataRoot "uploads")
        license = (Join-Path $DataRoot "license\license.lic.json")
        logs = (Join-Path $DataRoot "logs")
        backups = (Join-Path $DataRoot "backups")
        data = $DataRoot
      }
      security = @{
        jwtSecret = ""
        jwtExpiresIn = "24h"
        forceAdminPasswordReset = $forceReset
        ldapRejectUnauthorized = $true
        setupMode = $setupMode
      }
      smtp = @{ host = ""; port = 465; user = ""; pass = "" }
      cors = @{ origins = @() }
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($configPath, (($cfg | ConvertTo-Json -Depth 8) + "`r`n"), $utf8NoBom)
    Write-Log "Wrote config.json (setupMode=$setupMode)"
  } elseif ($setupMode) {
    # Ensure setupMode is on before API start (skip seedDefaultAdmin)
    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $cfg.security) { $cfg | Add-Member -NotePropertyName security -NotePropertyValue (@{}) }
    $cfg.security | Add-Member -NotePropertyName setupMode -NotePropertyValue $true -Force
    $cfg.security | Add-Member -NotePropertyName forceAdminPasswordReset -NotePropertyValue $false -Force
    if (-not $cfg.server.port) { } else { $cfg.server.port = $chosen }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($configPath, (($cfg | ConvertTo-Json -Depth 8) + "`r`n"), $utf8NoBom)
    Write-Log "Updated config.json setupMode=true"
  }

  $versionPath = Join-Path $DataRoot "version.json"
  if (-not (Test-Path $versionPath)) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $versionJson = (@{
      productVersion = "1.0.0"
      schemaVersion = 1
      installerVersion = "1.0.0"
      nodeVersion = "22.x"
      mongoVersion = "8.x"
    } | ConvertTo-Json) + "`r`n"
    [System.IO.File]::WriteAllText($versionPath, $versionJson, $utf8NoBom)
  }

  # mongod.cfg (use forward slashes - PS -replace '\\','\\' doubles backslashes and breaks mongod)
  $mongoDbPath = ((Join-Path $DataRoot "mongodb") -replace "\\", "/")
  $mongoLogPath = ((Join-Path $DataRoot "logs\mongo\mongod.log") -replace "\\", "/")
  $mongoCfg = @"
storage:
  dbPath: $mongoDbPath
systemLog:
  destination: file
  path: $mongoLogPath
  logAppend: true
net:
  bindIp: 127.0.0.1
  port: $MongoPort
"@
  Set-Content -Path (Join-Path $InstallRoot "runtime\mongodb\mongod.cfg") -Value $mongoCfg -Encoding Ascii

  # Registry identity
  $reg = "HKLM:\Software\Wisbility\ADSecurity"
  New-Item -Path $reg -Force | Out-Null
  New-ItemProperty -Path $reg -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $reg -Name DataRoot -Value $DataRoot -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $reg -Name Port -Value $chosen -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $reg -Name ProductVersion -Value "1.0.0" -PropertyType String -Force | Out-Null

  # mongod requires VC++ runtime; install shipped redist if missing (exit -1073741515 / STATUS_DLL_NOT_FOUND otherwise)
  $vcruntime = Join-Path $env:SystemRoot "System32\vcruntime140.dll"
  if (-not (Test-Path $vcruntime)) {
    $redist = Join-Path $InstallRoot "runtime\mongodb\bin\vc_redist.x64.exe"
    if (-not (Test-Path $redist)) {
      throw "mongod requires Visual C++ Redistributable, but vc_redist.x64.exe is missing under runtime\mongodb\bin"
    }
    Write-Log "Installing Visual C++ Redistributable (required by mongod)..."
    $redistProc = Start-Process -FilePath $redist -ArgumentList "/install", "/quiet", "/norestart" -Wait -PassThru
    # 0=ok, 1638=already installed, 3010=success reboot required
    if ($redistProc.ExitCode -notin 0, 1638, 3010) {
      throw "VC++ redistributable install failed with exit $($redistProc.ExitCode)"
    }
    if (-not (Test-Path $vcruntime)) {
      throw "VC++ redistributable installed but vcruntime140.dll still missing"
    }
  }

  # Register services (WinSW exe must be present)
  $winsw = Join-Path $InstallRoot "runtime\winsw"
  $mongoSvc = Join-Path $winsw "ADSecurity.Mongo.exe"
  $apiSvc = Join-Path $winsw "ADSecurity.API.exe"
  $mongodBin = Join-Path $InstallRoot "runtime\mongodb\bin\mongod.exe"
  $nodeBin = Join-Path $InstallRoot "runtime\node\node.exe"
  $missing = @()
  if (-not (Test-Path -LiteralPath $mongoSvc)) { $missing += $mongoSvc }
  if (-not (Test-Path -LiteralPath $apiSvc)) { $missing += $apiSvc }
  if (-not (Test-Path -LiteralPath $mongodBin)) { $missing += $mongodBin }
  if (-not (Test-Path -LiteralPath $nodeBin)) { $missing += $nodeBin }
  if ($missing.Count -gt 0) {
    throw ("Required runtime binaries are missing. Drop WinSW/Node/Mongo into installer\runtime before packaging. Missing:`r`n  - " + ($missing -join "`r`n  - "))
  }

  Copy-Item (Join-Path $InstallRoot "runtime\winsw\ADSecurity.API.xml") -Destination (Join-Path $winsw "ADSecurity.API.xml") -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $InstallRoot "runtime\winsw\ADSecurity.Mongo.xml") -Destination (Join-Path $winsw "ADSecurity.Mongo.xml") -Force -ErrorAction SilentlyContinue

  Push-Location $winsw
  foreach ($svcExe in @($apiSvc, $mongoSvc)) {
    try { & $svcExe stop 2>&1 | Out-Null } catch {}
  }
  Start-Sleep -Seconds 2
  foreach ($svcExe in @($apiSvc, $mongoSvc)) {
    try { & $svcExe uninstall 2>&1 | Out-Null } catch {}
  }
  Start-Sleep -Seconds 1

  Write-ProgressStep -Step "install_mongo" -Message "Installing MongoDB..." -Percent 20
  & $mongoSvc install
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "ADSecurity.Mongo.exe install failed with exit $LASTEXITCODE" }
  & $mongoSvc start
  Write-Log "Waiting for Mongo readiness..."
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect("127.0.0.1", $MongoPort)
      $tcp.Close()
      $ready = $true
      break
    } catch {}
  }
  if (-not $ready) { throw "Mongo did not become ready on port $MongoPort" }

  Write-ProgressStep -Step "install_api" -Message "Installing API..." -Percent 35
  & $apiSvc install
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "ADSecurity.API.exe install failed with exit $LASTEXITCODE" }
  & $apiSvc start
  Pop-Location

  Write-ProgressStep -Step "check_health" -Message "Checking Health..." -Percent 45
  $apiReady = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$chosen/api/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $apiReady = $true; break }
    } catch {}
  }
  if (-not $apiReady) { throw "API health check failed on port $chosen" }

  Write-ProgressStep -Step "init_database" -Message "Initializing Database..." -Percent 55
  if (-not (Wait-ApiFullyReady -ApiPort $chosen -TimeoutSec 120)) {
    throw "API did not finish database initialization on port $chosen"
  }

  # First-run bootstrap (skip for upgrade/repair or when no setup file)
  if ($script:SetupSecrets -and $Mode -eq "fresh") {
    $licenseDest = Join-Path $DataRoot "license\license.lic.json"
    $srcLicense = [string]$script:SetupSecrets.licenseSourcePath
    if (-not $srcLicense -or -not (Test-Path -LiteralPath $srcLicense)) {
      throw "License source file is missing"
    }
    Write-ProgressStep -Step "import_license" -Message "Importing License..." -Percent 65
    Copy-Item -LiteralPath $srcLicense -Destination $licenseDest -Force
    Set-RestrictedAcl (Join-Path $DataRoot "license")
    Set-HiddenSystem (Join-Path $DataRoot "license")

    Invoke-SetupInitialize -ApiPort $chosen -LicenseDest $licenseDest -Secrets $script:SetupSecrets

    # Clear setupMode after success
    try {
      $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      $cfg.security.setupMode = $false
      $utf8NoBom = New-Object System.Text.UTF8Encoding $false
      [System.IO.File]::WriteAllText($configPath, (($cfg | ConvertTo-Json -Depth 8) + "`r`n"), $utf8NoBom)
    } catch {
      Write-Log "Warning: could not clear setupMode flag"
    }
  } else {
    Write-Log "Skipping setup initialize (mode=$Mode, hasSetupFile=$([bool]$script:SetupSecrets))"
  }

  Remove-SetupFileSafe $SetupFile
  $script:SetupSecrets = $null

  Write-ProgressStep -Step "complete" -Message "Installation Complete" -Percent 100
  Write-Log "Install configuration completed successfully on port $chosen"
  exit 0
}
catch {
  $errMsg = $_.Exception.Message
  Write-ProgressStep -Step "error" -Message "Configuration failed" -Percent 100 -ErrorMessage $errMsg
  Write-Log ("ERROR: " + $errMsg)
  Remove-SetupFileSafe $SetupFile
  $script:SetupSecrets = $null
  Rollback-Install
  exit 1
}
