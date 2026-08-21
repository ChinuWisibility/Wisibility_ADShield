# Elevated Configure Validation

**Purpose:** Determine whether packaging/post-install logic works when `Configure-ADSecurity.ps1` runs under a **confirmed elevated** administrator token.

**Method:** Launch Windows PowerShell with `Run as Administrator` (`Start-Process -Verb RunAs`), then execute the same command line Inno Setup uses. No source code was modified.

**When:** 2026-07-28T22:19:10+05:30

---

## Exact command executed

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1" -InstallRoot "C:\Program Files\ADSecurity" -DataRoot "C:\ProgramData\ADSecurity"
```

This matches the Inno Setup `[Run]` Parameters string from `Setup Log 2026-07-28 #001.txt`.

Elevation wrapper (for capture only):

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\ADSecurity\logs\validation\run-elevated-configure.ps1
```

launched via `Start-Process -Verb RunAs` (UAC elevation). The wrapper then started the exact Inno command above with stdout/stderr redirected.

---

## Whether the PowerShell session was elevated

| Check | Result |
| --- | --- |
| Wrapper `IsInRole(Administrator)` | **True** |
| Wrapper identity | `DIPANKAR-PC\dipan` |
| Elevation method | `Start-Process -Verb RunAs` (UAC) |

The Configure process was started as a child of that elevated wrapper with the Inno-equivalent argument string.

---

## Exit code

```text
1
```

---

## Full stdout

```text
(empty)
```

Captured file: `C:\ProgramData\ADSecurity\logs\validation\elevated-configure-stdout.txt` (empty).

---

## Full stderr

```text
At C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1:94 char:76
+ ... ite-Log "Wrote config.json (no JWT secret �?" backend will generate)"
+                                                                          ~
Missing closing ')' in expression.
    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
    + FullyQualifiedErrorId : MissingEndParenthesisInExpression
```

Captured file: `C:\ProgramData\ADSecurity\logs\validation\elevated-configure-stderr.txt`.

### Interpretation of stderr

| Expected if Scenario A (`#Requires`) | Observed under elevation |
| --- | --- |
| `ScriptRequiresElevation` | **Not present** |
| Message about `#Requires -RunAsAdministrator` | **Not present** |
| Immediate admin-requires abort | Instead: **`ParserError` / `MissingEndParenthesisInExpression`** at line 94 |

Under a confirmed elevated session, PowerShell **did not** fail on `#Requires -RunAsAdministrator`. It failed while **parsing** line 94: a `Write-Log` string whose Unicode dash is shown corrupted in the error (`�?"`), breaking the quoted string and producing a parse error.

So this validation does **not** show packaging success when elevated. It shows a **different blocking failure** than the non-elevated `ScriptRequiresElevation` case.

---

## Files created

| Path | Created by this elevated Configure run? |
| --- | --- |
| `C:\ProgramData\ADSecurity\config\config.json` | **No** (`False`) |
| `C:\ProgramData\ADSecurity\logs\installer\` | Directory may already have existed from earlier investigation; **no new `install-*.log` from Configure** (`installerLogFiles` was empty) |
| Configure body side effects (version.json, mongod.cfg rewrite, registry `Port`, etc.) | **No** — parse failed before body execution |

---

## Services created

| Service | WinSW `status` | `Get-Service` |
| --- | --- | --- |
| `ADSecurity.API` | `NonExistent` | not found |
| `ADSecurity.Mongo` | `NonExistent` | not found |

**Were the services installed?** No.

**Can the services be started?** No — they do not exist.

---

## Health check results

| Probe | Result |
| --- | --- |
| `GET http://127.0.0.1:8081/api/health` | **Unable to connect to the remote server** |
| Listening API | **No** |

---

## Browser / root URL result

| Probe | Result |
| --- | --- |
| `GET http://127.0.0.1:8081/` | **Unable to connect to the remote server** |
| Serves React (`index.html`) | **No** |
| JSON `NOT_FOUND` | **No** (API not reachable at all) |

There is no SPA vs API-404 comparison available after this run because the API process never came up.

---

## Validation checklist (requested)

| Question | Answer |
| --- | --- |
| Was `config.json` created? | **No** |
| Was `logs\installer` created / used by Configure? | Dir may pre-exist; **Configure wrote no install log** |
| Were `ADSecurity.API` / `ADSecurity.Mongo` installed? | **No** |
| Can services be started? | **No** (non-existent) |
| Does `http://127.0.0.1:8081` serve React instead of JSON `NOT_FOUND`? | **No** — connection refused / unable to connect |

---

## Experiment conclusion

**Packaging post-install logic is not validated as correct under elevation**, because elevated Configure still exited `1` before doing any install work.

| Mode | Dominant failure (directly observed) |
| --- | --- |
| Non-elevated (prior experiment) | `FullyQualifiedErrorId : ScriptRequiresElevation` |
| **Elevated (this experiment)** | `FullyQualifiedErrorId : MissingEndParenthesisInExpression` (**ParserError** at line 94) |

### What this means for the root-cause story

1. **`#Requires -RunAsAdministrator` is not the failure mode of an elevated run.** With a confirmed admin token, that gate is cleared far enough for the parser to report a later syntax error (or the script fails at parse before any body side effects).
2. **Elevated execution currently still fails** due to a **parse/encoding break on line 94** of the installed `Configure-ADSecurity.ps1` (Unicode dash in the log string appearing corrupted in the parser error).
3. Therefore: even if Inno’s child were elevated, **this validation shows Configure would still not complete** (no `config.json`, no WinSW services, no HTTP listener) until that parse failure is addressed — without making that change in this experiment.

### Artifact paths

| Artifact | Path |
| --- | --- |
| Result JSON | `C:\ProgramData\ADSecurity\logs\validation\elevated-configure-result.json` |
| Stdout | `C:\ProgramData\ADSecurity\logs\validation\elevated-configure-stdout.txt` |
| Stderr | `C:\ProgramData\ADSecurity\logs\validation\elevated-configure-stderr.txt` |
| Wrapper script used | `C:\ProgramData\ADSecurity\logs\validation\run-elevated-configure.ps1` |
