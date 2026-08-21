# Installer Service Install Root Cause

**Verdict:** Inno Setup **did** invoke `Configure-ADSecurity.ps1`. That PowerShell process exited with **code 1 in ~1.1 seconds** and **never executed the script body**. The exact failing step is the first line of the script:

```powershell
#Requires -RunAsAdministrator
```

PowerShell aborted with a **requires-elevation / `ScriptRequiresElevation`** failure before `logs\installer`, `config.json`, registry `Port`, or any WinSW `install` ran. Configure’s `catch` / `Rollback-Install` never ran. Inno still reported the file install as succeeded and ignored the Run exit code.

No code was changed for this investigation.

---

## Exact failing step

| Item | Detail |
| --- | --- |
| Step | PowerShell `#Requires -RunAsAdministrator` gate |
| File | `C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1` (line 1) |
| When | Immediately after Inno `[Run]` spawned PowerShell |
| Evidence | Exit code 1 in **1097 ms**; no `logs\installer`; script body side effects absent |
| Not reached | ProgramData tree creation, `config.json`, WinSW Mongo/API `install`, health waits, `Rollback-Install` |

---

## Answers

### 1. Did `Configure-ADSecurity.ps1` execute?

**It was started, then aborted before the body ran.**

Inno Setup log (`C:\Users\dipan\AppData\Local\Temp\Setup Log 2026-07-28 #001.txt`):

```text
2026-07-28 20:57:26.904   -- Run entry --
2026-07-28 20:57:26.904   Run as: Current user
2026-07-28 20:57:26.904   Type: Exec
2026-07-28 20:57:26.906   Filename: powershell.exe
2026-07-28 20:57:26.906   Parameters: -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1" -InstallRoot "C:\Program Files\ADSecurity" -DataRoot "C:\ProgramData\ADSecurity"
2026-07-28 20:57:27.993   Process exit code: 1
```

Windows PowerShell log at the same second shows engine **None → Available → Stopped** for that exact HostApplication, with **no** script-body logging and **no** `install-*.log` under ProgramData.

Body never ran — proven by missing first side effect of the script:

```powershell
$logDir = Join-Path $DataRoot "logs\installer"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
```

`C:\ProgramData\ADSecurity\logs\installer` does **not** exist.

### 2. If yes, where did it fail?

**At `#Requires -RunAsAdministrator` (pre-body).**

Failure mode matching a non-admin / non-elevated session reproduce:

```text
The script 'Configure-ADSecurity.ps1' cannot be run because it contains a "#requires" statement for running as Administrator.
...
FullyQualifiedErrorId : ScriptRequiresElevation
EXIT=1
logs\installer exists? False
```

Same timing class (~1s), same exit code, same absence of installer log.

It did **not** fail later at Mongo readiness, API health, or WinSW — those paths would have already created `logs\installer` and (for most failures after line 63) the ProgramData tree / `config.json`.

### 3. Was it invoked by Inno Setup?

**Yes.**

From `installer\ADSecurity.iss` `[Run]`:

```iss
Filename: "powershell.exe";
Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Configure-ADSecurity.ps1"" -InstallRoot ""{app}"" -DataRoot ""{commonappdata}\ADSecurity""";
StatusMsg: "Configuring Identity Sphere…";
Flags: runhidden waituntilterminated
```

Setup log confirms that Run entry ran after files/icons/registry, from `D:\ADSecuritySetup.exe`, Inno Setup 7.0.2.

### 4. Was it blocked by UAC?

**Setup itself was not blocked by UAC.**

Setup log:

```text
User privileges: Administrative
Administrative install mode: Yes
```

So the installer process elevated successfully.

What failed is the **PowerShell `#Requires -RunAsAdministrator` check** on the Configure child process: PowerShell did not treat that session as an administrator session. That is an elevation/`#Requires` gate on the Configure process, not a UAC deny of `ADSecuritySetup.exe`.

(Inno logged `Run as: Current user`, which for a non-`postinstall` `[Run]` entry means inherit Setup’s token — intended to be the elevated install token. Regardless of Inno’s intent, the observed Configure outcome matches a session that failed `#Requires -RunAsAdministrator`.)

### 5. Was ExecutionPolicy preventing it?

**No.**

Parameters included `-ExecutionPolicy Bypass`. HostApplication in the PowerShell event at 20:57:27 also shows `-ExecutionPolicy Bypass`. There is no ExecutionPolicy error in the install-time logs.

### 6. Was there a PowerShell exception?

**Not a script `try/catch` exception.**

Configure’s error handler:

```powershell
catch {
  Write-Log ("ERROR: " + $_.Exception.Message)
  Rollback-Install
  exit 1
}
```

never ran:

- No `logs\installer\install-*.log` (would contain `ERROR: …` and `ROLLBACK: …`)
- Program Files payload still present (Rollback deletes `{app}`)

The termination is the **pre-execution `#Requires` failure** (`ScriptRequiresElevation` / `PermissionDenied`), which exits before `param` body work and before `try`.

### 7. Why were `ADSecurity.API` and `ADSecurity.Mongo` services not created?

**WinSW `install` was never reached.**

Those commands are only in Configure after ProgramData/config/registry setup:

```powershell
& ".\ADSecurity.Mongo.exe" install
...
& ".\ADSecurity.API.exe" install
```

Because the script stopped at `#Requires`, no service registration occurred.

Later Launch/Repair attempts only prove non-existence:

```text
# WinSW status
NonExistent
NonExistent

# Wrapper logs after Launch (~20:57:38–45)
FATAL - The specified service does not exist as an installed service.
```

### 8. Was rollback executed?

**Configure rollback: No.**

`Rollback-Install` only runs inside `catch`. Body never entered `try`/`catch`.

**Inno rollback: No.**

Setup log order:

```text
Installation process succeeded.    # before Run
-- Run entry --
Process exit code: 1               # Configure failed; install still kept
Deinitializing Setup.
```

Inno does not fail/roll back the installed files when this `[Run]` entry returns 1 (`runhidden waituntilterminated` only waits; exit code is not treated as install failure here). `{app}` remains; uninstall entry remains.

### 9. Installer logs proving the failure

**Primary proof — Inno Setup log**

Path: `C:\Users\dipan\AppData\Local\Temp\Setup Log 2026-07-28 #001.txt`

Relevant facts:

| Log line | Meaning |
| --- | --- |
| `Original Setup EXE: D:\ADSecuritySetup.exe` | Packaged installer used |
| `User privileges: Administrative` | Setup elevated |
| `Successfully installed` … scripts including `Configure-ADSecurity.ps1` | Script file was on disk before Run |
| Registry `InstallRoot` / `DataRoot` / `ProductVersion` set | From Inno `[Registry]`, not Configure |
| `Installation process succeeded.` | File/registry phase OK |
| Run entry → `Process exit code: 1` in ~1.1s | Configure failed immediately |
| No further configure success lines | No completed post-install |

**Secondary proof — Windows PowerShell log (20:57:27)**

HostApplication:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1 -InstallRoot C:\Program Files\ADSecurity -DataRoot C:\ProgramData\ADSecurity
```

Events: engine start (400) then stop (403) in the same second — no durable Configure work.

**Missing proof that would exist if the body had run**

- `C:\ProgramData\ADSecurity\logs\installer\install-YYYYMMDD-HHMMSS.log` — **absent**
- That log’s `Starting Identity Sphere post-install configuration` / `ERROR:` / `ROLLBACK:` lines — **absent**

**Post-install noise (not Configure)**

`C:\ProgramData\ADSecurity\logs\api|mongo\*.wrapper.log` at 20:57:38–45 are from later WinSW console/`Launch-ADSecurity.ps1` attempts against **uninstalled** services.

### 10. Why was `ProgramData\config\config.json` never created?

Configure creates it only after `#Requires` passes and after creating the ProgramData directory tree:

```powershell
$configPath = Join-Path $DataRoot "config\config.json"
if (-not (Test-Path $configPath)) {
  ...
  Set-Content -Path $configPath ...
}
```

Because execution stopped at `#Requires -RunAsAdministrator`:

- `config\` was never created
- `config.json` was never written

Inno Setup does **not** create `config.json`; only Configure (or Repair’s folder recreate without writing config) would. Registry values present today (`InstallRoot`, `DataRoot`, `ProductVersion`) come from Inno’s `[Registry]` section. Configure would also write **`Port` (DWord)** — that value is **absent**, confirming Configure never reached its registry block.

Current ProgramData after install + later Launch attempts:

```text
C:\ProgramData\ADSecurity\logs\api\...
C:\ProgramData\ADSecurity\logs\mongo\...
```

No `config\`, `license\`, `uploads\`, `mongodb\`, `backups\`, or `logs\installer\`.

---

## Causal chain

```text
ADSecuritySetup.exe (elevated Inno, PrivilegesRequired=admin)
  → copies payload + scripts
  → writes HKLM\...\InstallRoot|DataRoot|ProductVersion
  → [Run] powershell.exe -ExecutionPolicy Bypass -File Configure-ADSecurity.ps1 ...
      → PowerShell loads script
      → #Requires -RunAsAdministrator FAILS (ScriptRequiresElevation)
      → exit 1 (~1.1s)
      → body never runs → no config.json, no WinSW install, no Rollback-Install
  → Inno ignores Run exit code; marks file install succeeded
→ Launch later → WinSW "service does not exist"
```

---

## What this is / is not

| Claim | Result |
| --- | --- |
| Configure never referenced by Inno | **False** — `[Run]` invoked it |
| Configure failed mid-flight (Mongo/API) | **False** — body never started |
| ExecutionPolicy blocked script | **False** — Bypass set |
| UAC blocked the Setup EXE | **False** — Administrative install mode |
| Configure `Rollback-Install` wiped ProgramData | **False** — rollback not entered; ProgramData config never created |
| Services missing because WinSW binaries missing | **False** — `ADSecurity.API.exe` / `.Mongo.exe` + XML exist under `runtime\winsw` |

---

## One-sentence root cause

**Post-install configuration failed at PowerShell `#Requires -RunAsAdministrator` on the Inno-launched Configure process (exit 1 before any Configure side effects), so services and `config.json` were never created; Inno kept the file install anyway.**
