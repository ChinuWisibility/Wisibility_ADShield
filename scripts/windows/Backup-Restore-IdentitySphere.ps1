#Requires -RunAsAdministrator
param(
  [ValidateSet("backup", "restore")]
  [string]$Action = "backup",
  [string]$DataRoot = "C:\ProgramData\ADSecurity",
  [string]$InstallRoot = "C:\Program Files\ADSecurity",
  [string]$BackupDir = "",
  [string]$SourceBackup = ""
)

$ErrorActionPreference = "Stop"
$mongodump = Join-Path $InstallRoot "runtime\mongodb\bin\mongodump.exe"
$mongorestore = Join-Path $InstallRoot "runtime\mongodb\bin\mongorestore.exe"
$backupsRoot = Join-Path $DataRoot "backups\db"

if ($Action -eq "backup") {
  if (-not $BackupDir) {
    $BackupDir = Join-Path $backupsRoot (Get-Date -Format "yyyyMMdd-HHmmss")
  }
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  & $mongodump --host 127.0.0.1 --port 27017 --out (Join-Path $BackupDir "mongo")
  Copy-Item (Join-Path $DataRoot "config\config.json") (Join-Path $BackupDir "config.json") -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $DataRoot "version.json") (Join-Path $BackupDir "version.json") -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $DataRoot "license") (Join-Path $BackupDir "license") -Recurse -ErrorAction SilentlyContinue
  Write-Host "Backup complete: $BackupDir"
  exit 0
}

if (-not $SourceBackup) { throw "-SourceBackup is required for restore" }
$safety = Join-Path $backupsRoot ("pre-restore-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $safety | Out-Null
& $mongodump --host 127.0.0.1 --port 27017 --out (Join-Path $safety "mongo")
& $mongorestore --host 127.0.0.1 --port 27017 --drop (Join-Path $SourceBackup "mongo")
Write-Host "Restore complete from $SourceBackup (safety backup at $safety)"
