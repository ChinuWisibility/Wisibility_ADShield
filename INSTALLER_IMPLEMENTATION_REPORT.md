# ADSecurity Installer Implementation Report

**Date:** 2026-07-29  
**Status:** Implemented per revised `INSTALLER_REDESIGN_PLAN.md` (atomic initialize, encrypted setup file, summary page, DB init stage)

---

## Summary

First-run bootstrap is now a single backend call (`POST /api/setup/initialize`) orchestrated by Configure after API + database readiness. Inno collects admin + license, shows an Installation Summary, DPAPI-encrypts secrets, and **fails closed** if Configure exits non-zero. Repair/upgrade skip first-run pages. Legacy silent installs without a setup file still use `seedDefaultAdmin`.

---

## Files changed / added

### Backend (`icm-backend`)

| Path | Change |
| --- | --- |
| `src/services/setup/setupTokenService.js` | **New** — 10-min one-shot setup token file |
| `src/services/setup/setupInitializeService.js` | **New** — atomic admin + tenant + password policy + license; rollback on license failure |
| `src/middleware/setupAuth.js` | **New** — `X-ADSecurity-Setup-Token` gate |
| `src/controllers/setupController.js` | **New** |
| `src/routes/setupRoutes.js` | **New** — `POST /initialize` |
| `src/services/setup/__tests__/*.test.js` | **New** — 9 unit tests (passing) |
| `src/server.js` | Mount `/api/setup`; license-exempt; skip `seedDefaultAdmin` when `setupMode` |
| `src/config/env.js` | `setupMode` from config / `FORCE_SETUP_BOOTSTRAP` |
| `src/config/productionConfig.js` | Joi `security.setupMode` |

### Installer

| Path | Change |
| --- | --- |
| `installer/ADSecurity.iss` | Admin / License / Summary pages; DPAPI setup file; Configure from `[Code]` with `RaiseException` fail-closed; silent/upgrade skip |
| `installer/scripts/Configure-ADSecurity.ps1` | `-SetupFile`, `-Mode`, progress.json, ACL, DB wait, initialize call |
| `installer/scripts/Protect-SetupParams.ps1` | **New** — DPAPI LocalMachine protect + delete plaintext |
| `installer/scripts/Stop-ADSecurityServices.ps1` | **New** — stop/unregister only |
| `installer/scripts/Launch-ADSecurity.ps1` | Resolve InstallRoot/DataRoot from registry |
| `installer/scripts/Repair-ADSecurity.ps1` | Registry roots; no admin/license re-prompt |
| `installer/scripts/Uninstall-ADSecurity.ps1` | Granular remove flags; services via Stop helper |

---

## API

### `POST /api/setup/initialize`

**Auth:** Header `X-ADSecurity-Setup-Token` (file `{DataRoot}\setup\setup.token`, TTL 10 minutes, deleted on success)

**Body:**

```json
{
  "admin": { "name": "...", "email": "...", "phone": "...", "password": "..." },
  "licensePath": "C:\\ProgramData\\ADSecurity\\license\\license.lic.json"
}
```

**Behavior:** Validate password policy → create tenant → create `superAdmin` (`isDefault`) → crypto-validate/activate license → mark setup complete. On license failure, delete created user/tenant/policy and return error.

**Exempt** from `LICENSE_REQUIRED` middleware (path `/api/setup`).

---

## Fresh-install workflow

1. Wizard: Admin → License (structural preview, including base64url payload decode) → Summary  
2. File copy  
3. Inno writes plaintext temp JSON → `Protect-SetupParams.ps1` (DPAPI) → deletes plaintext  
4. Configure: ProgramData + ACL (Admins+SYSTEM on license/setup/config) → Mongo → API → health → **Initializing Database** (`databaseReady` + `backgroundInitComplete`) → copy license → setup token → `POST /initialize` → verify license status → delete setup file/token  
5. Non-zero Configure → Inno `RaiseException` (install fails closed)

---

## Upgrade / Repair / Silent

| Mode | Admin/License/Summary | Bootstrap API |
| --- | --- | --- |
| Fresh (UI) | Shown | Yes |
| Upgrade (registry present) | Skipped | No |
| Silent (`/VERYSILENT`) | Skipped | No (`seedDefaultAdmin`) |
| Repair | N/A | No |

---

## Security controls

- No passwords on Configure command line (`-SetupFile` path only)  
- DPAPI LocalMachine encrypted blob; plaintext deleted immediately after protect and after successful initialize  
- Setup token: 10 min, one successful use, deleted on completion  
- License dir: Hidden+System; ACL Administrators + SYSTEM only  
- Password hashing and license crypto remain in backend only  

---

## Tests run

```text
jest --testPathPatterns=setup  →  2 suites, 9 tests passed
PowerShell Parser::ParseFile   →  Configure + Protect OK
ASCII scan installer/scripts   →  all OK
build-dist.mjs                 →  dist includes setup routes
```

---

## Packaging / validation still required on a build agent

1. Run `prepare-payload.ps1` so `payload\app\backend` includes rebuilt `dist` + `node_modules`  
2. Compile `ADSecurity.iss` with Inno Setup  
3. Fresh VM install with a real `*.lic.json`  
4. Confirm login with wizard credentials; `GET /api/license/status` licensed; SPA on `/`  
5. Upgrade path: re-run Setup → no admin/license pages; data retained  
6. Confirm password never appears in `logs\installer\*.log`

---

## Known limitations

- Inno progress UI shows a static progress page during Configure (stages are written to `progress.json` for logs / future live polling)  
- License preview decodes payload for display only; signature is not checked in the wizard  
- Full uninstall granular checkboxes are partially modeled (KeepData Y/N + Stop-Services); Uninstall.ps1 switches exist for scripting  
- Existing field installs need a **new Setup.exe** (and payload dist) before setup APIs are available under WinSW  

---

## How to retry Configure after a failed first-run

```powershell
# After overlaying new scripts + dist, elevated:
& "C:\Program Files\ADSecurity\scripts\Configure-ADSecurity.ps1" `
  -InstallRoot "C:\Program Files\ADSecurity" `
  -DataRoot "C:\ProgramData\ADSecurity" `
  -SetupFile "C:\path\to\idsphere-setup.dpapi" `
  -Mode fresh
```
