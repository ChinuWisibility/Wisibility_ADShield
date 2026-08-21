#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$InstallRoot = "C:\Program Files\ADSecurity"
$DataRoot = "C:\ProgramData\ADSecurity"
$log = "D:\Work\Wisibility_IGA\installer\clean-install-prep.log"

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $m
  Add-Content -Path $log -Value $line
  Write-Host $line
}

Remove-Item $log -Force -ErrorAction SilentlyContinue
Log "Starting elevated ADSecurity wipe for clean install test"

$winsw = Join-Path $InstallRoot "runtime\winsw"
if (Test-Path $winsw) {
  Push-Location $winsw
  foreach ($exe in @("ADSecurity.API.exe","ADSecurity.Mongo.exe")) {
    if (Test-Path ".\$exe") {
      Log "Stop $exe"
      & ".\$exe" stop 2>&1 | Out-Null
    }
  }
  Start-Sleep -Seconds 2
  foreach ($exe in @("ADSecurity.API.exe","ADSecurity.Mongo.exe")) {
    if (Test-Path ".\$exe") {
      Log "Uninstall $exe"
      & ".\$exe" uninstall 2>&1 | Out-Null
    }
  }
  Pop-Location
}

Get-Process -Name "ADSecurity.API","ADSecurity.Mongo","mongod" -ErrorAction SilentlyContinue | ForEach-Object {
  Log ("Kill {0} pid={1}" -f $_.ProcessName, $_.Id)
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.ExecutablePath -like "C:\Program Files\ADSecurity\*") {
    Log ("Kill ADSecurity node pid={0}" -f $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 2

# Prefer Inno uninstaller if present
$unins = Join-Path $InstallRoot "unins000.exe"
if (Test-Path $unins) {
  Log "Running Inno unins000.exe /VERYSILENT"
  $p = Start-Process -FilePath $unins -ArgumentList "/VERYSILENT","/NORESTART","/SUPPRESSMSGBOXES" -Wait -PassThru
  Log ("unins exit={0}" -f $p.ExitCode)
  Start-Sleep -Seconds 3
}

foreach ($p in @($InstallRoot, $DataRoot)) {
  if (Test-Path $p) {
    Log "takeown/icacls/remove $p"
    & takeown.exe /F $p /R /D Y 2>&1 | Out-Null
    & icacls.exe $p /grant Administrators:F /T /C /Q 2>&1 | Out-Null
    cmd /c "rmdir /s /q `"$p`"" 2>&1 | Out-Null
    if (Test-Path $p) {
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    }
    Log ("exists after remove: {0} -> {1}" -f $p, (Test-Path $p))
  } else {
    Log ("already gone: $p")
  }
}

Remove-Item -Path "HKLM:\Software\Wisbility\ADSecurity" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "HKLM:\Software\Wisbility" -Recurse -Force -ErrorAction SilentlyContinue

Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue | ForEach-Object {
  $prop = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($prop.DisplayName -like "*Identity Sphere*" -or $prop.DisplayName -like "*ADSecurity*") {
    Log ("Remove uninstall key {0}" -f $_.PSChildName)
    Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Log "=== VERIFY ==="
Log ("Services: " + ((Get-Service ADSecurity* -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ","))
Log ("ProgramFiles: " + (Test-Path $InstallRoot))
Log ("ProgramData: " + (Test-Path $DataRoot))
Log ("Registry: " + (Test-Path "HKLM:\Software\Wisbility\ADSecurity"))
$ports = Get-NetTCPConnection -LocalPort 8081,27017 -State Listen -ErrorAction SilentlyContinue
if ($ports) { Log ("Ports still listening: " + (($ports | ForEach-Object { $_.LocalPort }) -join ",")) } else { Log "Ports 8081/27017 free" }
Log "DONE"
