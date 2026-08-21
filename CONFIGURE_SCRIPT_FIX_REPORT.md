# Configure Script Fix Report

**Date:** 2026-07-28  
**Scope:** Permanent ASCII-safe fix for `installer/scripts` under Windows PowerShell 5.1 and PowerShell 7+, plus post-fix validation of config, services, API health, and SPA serving.

---

## Verdict

The PowerShell 5.1 `ParserError` / `MissingEndParenthesisInExpression` is **fixed in source** by replacing Unicode punctuation (`—`, `…`) with ASCII (`-`, `...`). All `installer/scripts/*.ps1` are **ASCII-only** (`nonAscii=0`).

Elevated `Configure-ADSecurity.ps1` now **parses and completes successfully**. Live validation on this machine:

| Check | Result |
| --- | --- |
| `ParseFile` on installed Configure | **OK** |
| Non-ASCII bytes in installed Configure | **0** |
| Configure log | `Install configuration completed successfully on port 8081` (`install-20260728-232037.log`) |
| `config.json` | Present under `C:\ProgramData\ADSecurity\config\` |
| `mongod.cfg` | Forward-slash paths, ASCII encoding |
| `ADSecurity.Mongo` / `ADSecurity.API` | **Running** |
| `GET /api/health` | **200** `status=healthy`, `environment=production`, `databaseReady=true` |
| `GET /` | **200** `text/html`, `<!doctype html>`, **not** `NOT_FOUND` JSON |

---

## Code changes (repo)

### 1. Unicode → ASCII (parser fix)

**Files:**

- `installer/scripts/Configure-ADSecurity.ps1`
- `installer/scripts/Repair-ADSecurity.ps1`

**Why:** BOM-less UTF-8 with em dash `—` (`E2 80 94`) inside double-quoted strings is mis-decoded by Windows PowerShell 5.1 as Windows-1252, producing a U+201D `”` that ends the string early. See `CONFIGURE_SCRIPT_PARSER_ROOT_CAUSE.md`.

**What:** Replaced `—` → `-`, `…` → `...` in log/message strings. No behavioral change intended beyond parseability.

**Scan:** All five scripts under `installer/scripts/` verified `nonAscii=0`:

| Script | Size | Non-ASCII |
| --- | ---: | ---: |
| `Configure-ADSecurity.ps1` | 8043 | 0 |
| `Repair-ADSecurity.ps1` | 1312 | 0 |
| `Launch-ADSecurity.ps1` | 677 | 0 |
| `Uninstall-ADSecurity.ps1` | 883 | 0 |
| `Wait-MongoReady.ps1` | 478 | 0 |

### 2. `mongod.cfg` path / encoding (needed for Mongo readiness)

**File:** `installer/scripts/Configure-ADSecurity.ps1`

**Why:** After the parser fix, Configure reached Mongo start but failed with `Mongo did not become ready on port 27017`. Root causes:

1. `-replace '\\','\\'` **doubled** backslashes in `dbPath` / log path (`C:\\ProgramData\\...`), which mongod rejects.
2. `Set-Content -Encoding UTF8` on Windows PowerShell 5.1 writes a **UTF-8 BOM**, which can break mongod’s YAML parser.

**What:**

- Normalize paths with forward slashes: `-replace "\\", "/"`.
- Write cfg with `-Encoding Ascii`.

Resulting cfg (validated):

```yaml
storage:
  dbPath: C:/ProgramData/ADSecurity/mongodb
systemLog:
  destination: file
  path: C:/ProgramData/ADSecurity/logs/mongo/mongod.log
  logAppend: true
net:
  bindIp: 127.0.0.1
  port: 27017
```

### 3. Rollback retains Program Files (retryability)

**File:** `installer/scripts/Configure-ADSecurity.ps1`

**Why:** Previous rollback deleted the Program Files payload after Configure failure, forcing a full reinstall to retry.

**What:** Rollback now stops/uninstalls WinSW services only and **keeps** Program Files + ProgramData.

---

## Validation evidence

### Parser

- Installed Configure: `ParseFile` → **OK**, `nonAscii=0`.
- Messages in successful run are ASCII (e.g. `Wrote config.json (no JWT secret - backend will generate)`).

### Configure success

From `C:\ProgramData\ADSecurity\logs\installer\install-20260728-232037.log`:

```
Starting Identity Sphere post-install configuration
Waiting for Mongo readiness...
Install configuration completed successfully on port 8081
```

### Services / HTTP

- Services: `ADSecurity.API` = Running, `ADSecurity.Mongo` = Running
- Health: `http://127.0.0.1:8081/api/health` → 200, production, DB ready
- SPA: `http://127.0.0.1:8081/` → HTML document with `#root` (not Express `NOT_FOUND` JSON)

Compact validation snapshot: `C:\ProgramData\ADSecurity\logs\validation\spa-validate-result.json`

---

## Blocking issues found during validation (outside original Unicode bug)

These are **not** caused by the PS Unicode punctuation, but blocked end-to-end SPA validation until addressed on the installed tree:

### A. Packaged backend dist bad relative imports

`ADSecurity.API.err.log` showed crash loops:

```
ERR_MODULE_NOT_FOUND: Cannot find module
  ...\dist\services\config\versionMetadata.js
imported from
  ...\dist\services\migrations\migrationRunner.js
```

Packaged dist used `from "../config/..."` (resolves under `services/config/`) instead of `from "../../config/..."` (correct for `dist/config/`).

Repo **source** already has the correct `../../config/` paths. The Jul 26 Setup payload’s `dist` is wrong.

**Validation workaround:** rewritten installed `dist/services/**/*.js` imports `../config/` → `../../config/` where depth requires it. After that, API started and health/SPA succeeded.

**Permanent fix still needed:** rebuild backend dist / `prepare-payload` so the next Setup embeds correct imports (and rebuild `ADSecuritySetup.exe`).

### B. Empty `node_modules` in packaged backend

Post-install `npm install --omit=dev` was required (`nm_before=0`). Confirm whether payload should vendor production modules or always run npm during Configure.

### C. Packaged Setup still embeds **old** scripts

Until Setup is rebuilt from this repo, Inno’s post-install still ships the Unicode-broken Configure. Validation overwrote:

`C:\Program Files\ADSecurity\scripts\*.ps1`

from `D:\Work\Wisibility_IGA\installer\scripts\`.

---

## Residual gaps / next packaging steps

1. Rebuild installer payload + `ADSecuritySetup.exe` so customers get ASCII Configure + fixed `mongod.cfg` logic without manual overwrite.
2. Fix packaging so backend `dist` preserves correct `../../config/` imports (or ship a verified build artifact).
3. Decide on vendoring `node_modules` vs Configure-time `npm install`.
4. Optional: add a CI check that `installer/scripts/*.ps1` contain only bytes ≤ 127 (or save as UTF-8 **with BOM** if Unicode must be kept — ASCII is simpler and safer for PS 5.1).

---

## Summary

| Item | Status |
| --- | --- |
| PS 5.1 parser Unicode root cause | Fixed (ASCII punctuation) |
| `mongod.cfg` path doubling / UTF-8 BOM | Fixed |
| Rollback wipe of Program Files | Softened (retain payload) |
| Elevated Configure completes | **Verified** |
| WinSW services Running | **Verified** |
| `/api/health` + SPA HTML | **Verified** |
| Setup.exe embeds fix | **Not yet** (rebuild required) |
| Packaged dist import paths | **Separate bug**; patched on disk for this validation |
