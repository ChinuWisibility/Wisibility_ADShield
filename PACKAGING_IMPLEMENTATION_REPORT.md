# PACKAGING_IMPLEMENTATION_REPORT.md

**Product:** Identity Sphere (Wisbility)  
**Audit type:** Complete implementation audit of Windows offline packaging  
**Code changes during this audit:** NONE (read-only)  
**Date:** 2026-07-27  

---

# 1. Packaging Architecture

## What this packaging is (and is not)

This product is **not** packaged with Electron, NW.js, pkg, or a single self-contained app EXE that embeds Chromium.

It is packaged as:

1. **`ADSecuritySetup.exe`** — an **Inno Setup** installer (the customer-facing “Windows .exe”).
2. After install, two **Windows Services** (via **WinSW**) run continuously:
   - `ADSecurity.Mongo` → embedded `mongod.exe`
   - `ADSecurity.API` → bundled `node.exe` running `app\backend\dist\server.js`
3. The **UI is the production React static build**, served by the **same Express process** (no Vite at runtime).
4. The **desktop shortcut** is not a native GUI app; it runs **`powershell.exe`** → `Launch-ADSecurity.ps1`, which starts services (best-effort) and opens the **system default browser**.

## Executable entry point

| Layer | Entry |
|-------|--------|
| Customer installer | `ADSecuritySetup.exe` (compiled from `installer/ADSecurity.iss`) |
| Desktop / Start Menu “app” | `powershell.exe -File …\scripts\Launch-ADSecurity.ps1` |
| API service | `…\runtime\node\node.exe` + `…\app\backend\dist\server.js` |
| Data store service | `…\runtime\mongodb\bin\mongod.exe` + `mongod.cfg` |

There is **no** `launcher.js`, **no** `main.js` (Electron), and **no** Electron process.

## How the packaged application starts

### A) First install

```
ADSecuritySetup.exe
  → copies Program Files payload
  → runs Configure-ADSecurity.ps1 (elevated, hidden)
       → creates ProgramData tree + config.json + version.json
       → writes mongod.cfg
       → registers/starts ADSecurity.Mongo
       → waits for TCP 27017 (up to 60s)
       → registers/starts ADSecurity.API
       → waits for HTTP /api/health (up to 90s)
       → rollback on failure
```

### B) Everyday use (desktop icon)

```
Desktop shortcut
  → powershell.exe Launch-ADSecurity.ps1
       → read port from ProgramData\config\config.json (default 8081)
       → WinSW start Mongo + API (best-effort)
       → Sleep 2 seconds
       → Start-Process http://127.0.0.1:<port>/
```

### C) Backend + frontend inside one Node process

```
ADSecurity.API (WinSW)
  → node.exe app\backend\dist\server.js
       → load config.json from ProgramData
       → license gate (or license-required minimal mode)
       → connect MongoDB
       → run migrations
       → listen(env.port, env.host)   # default 8081 / 0.0.0.0
       → mountSpaStatic() serves app\frontend (static SPA)
```

## Electron

**Not used.**

## Browser opening logic

`Launch-ADSecurity.ps1` calls `Start-Process "http://127.0.0.1:$port/"` which opens the default browser. It does **not** embed a browser.

## Process tree (runtime)

```
services.exe / SCM
 ├── ADSecurity.Mongo.exe (WinSW wrapper)
 │     └── mongod.exe --config …\runtime\mongodb\mongod.cfg
 └── ADSecurity.API.exe (WinSW wrapper)
       └── node.exe …\app\backend\dist\server.js
             └── (in-process) Express HTTP server
                   ├── /api/*     REST API
                   ├── /uploads/* static uploads
                   └── /*         React SPA (index.html)

User click Desktop shortcut (ephemeral):
powershell.exe
  └── Start-Process → default browser (msedge/chrome/…)
        └── GET http://127.0.0.1:<port>/
```

## ASCII flowchart

```
┌──────────────────────────────┐
│ ADSecuritySetup.exe      │
│ (Inno Setup installer)       │
└──────────────┬───────────────┘
               │ copy files + Run Configure-*.ps1
               ▼
┌──────────────────────────────┐
│ Program Files\ADSecurity │  immutable app + runtime
│ ProgramData\ADSecurity   │  config, license, logs, db
└──────────────┬───────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐  ┌─────────────────┐
│ Mongo svc   │  │ API svc (WinSW) │
│ mongod:27017│◄─┤ depends on Mongo│
└─────────────┘  └────────┬────────┘
                          │ node dist/server.js
                          ▼
                 ┌────────────────────┐
                 │ Express :8081*     │
                 │ API + static SPA   │
                 └─────────┬──────────┘
                           │
┌──────────────────────────┼──────────────────────────┐
│ Desktop shortcut         │                          │
│ Launch-ADSecurity.ps1│── Sleep 2s ──► Browser   │
│ Start-Process URL        │              127.0.0.1:P │
└──────────────────────────┴──────────────────────────┘

* Port comes from config.json; default 8081 (NOT 8080).
```

---

# 2. Files Modified

These were modified as part of the packaging / production-runtime work (from packaging commit and related packaging diffs):

| Path | Purpose | Why modified |
|------|---------|--------------|
| `.gitignore` | Ignore runtime binaries, payload, local `.data`; allow `docs/windows-packaging/**` | Prevent shipping secrets/binaries; keep packaging docs trackable |
| `icm-backend/package.json` | Backend package metadata/scripts | Add `build` / `build:dist` / `start:prod`; set `main` to `dist/server.js` |
| `icm-backend/src/config/env.js` | Central runtime config | Prefer `config.json` in production; resolve ProgramData paths; JWT bootstrap; license paths |
| `icm-backend/src/licensing/LicenseLoader.js` | License file discovery | Prefer ProgramData / `LICENSE_PATH` before relative app-root paths |
| `icm-backend/src/licensing/LicenseManager.js` | License validation facade | Add `reload()` / `clear()` for hot license activation |
| `icm-backend/src/models/platform/User.js` | User schema | Add `mustChangePassword` for first-login hardening |
| `icm-backend/src/server.js` | HTTP app + boot | License-required mode, migrations, SPA mount, absolute uploads, health license fields, post-activation workers |
| `icm-backend/src/services/adLdapService.js` | LDAP client | Make LDAPS `rejectUnauthorized` configurable via config/env |
| `icm-backend/src/services/authService.js` | Auth / admin seed | Use `env.adminPassword` / `forceAdminPasswordReset`; clear `mustChangePassword` on change |
| `icm-backend/src/services/graph/graphIncrementalFlags.js` | Graph kill-switch path | Move kill-switch file under ProgramData / `ADSecurity_DATA` |
| `icm-frontend/src/layouts/Sidebar.jsx` | Admin nav | Add License menu item |
| `icm-frontend/src/routes/AppRoutes.jsx` | Router | Add `/admin/license` route |
| `icm-frontend/src/services/api.js` | API client | Add `licenseAPI` and `systemAPI` |

---

# 3. New Files Added

## Application / runtime (backend & frontend)

| Path | Role |
|------|------|
| `icm-backend/src/config/productPaths.js` | Resolve `ADSecurity_HOME` / `ADSecurity_DATA` |
| `icm-backend/src/config/productionConfig.js` | Load/validate/write `config.json` (Joi) |
| `icm-backend/src/config/secretsBootstrap.js` | Generate+persist JWT secret if missing |
| `icm-backend/src/config/versionMetadata.js` | Read/write `version.json` |
| `icm-backend/src/config/spaStatic.js` | Serve React `dist` from Express in production |
| `icm-backend/src/licensing/licenseRuntime.js` | Process-wide license singleton + activation hook |
| `icm-backend/src/controllers/licenseController.js` | License status / upload / reload |
| `icm-backend/src/routes/licenseRoutes.js` | `/api/license/*` |
| `icm-backend/src/routes/systemRoutes.js` | `/api/system/diagnostics`, `/api/system/info` |
| `icm-backend/src/services/migrations/migrationRunner.js` | Apply numbered migrations on boot |
| `icm-backend/src/services/system/diagnosticsService.js` | Diagnostics payload builder |
| `icm-backend/src/utils/productionConfig.test.js` | Unit tests for config/JWT/version helpers |
| `icm-backend/scripts/build-dist.mjs` | Copy `src/` → `dist/` for production entry |
| `icm-backend/migrations/001_baseline.js` | Baseline schema migration (packaging-era) |
| `icm-frontend/.env.production` | `VITE_API_BASE_URL=/api` for same-origin builds |
| `icm-frontend/src/pages/admin/LicenseManagement.jsx` | Admin license upload UI |

## Installer / packaging

| Path | Role |
|------|------|
| `installer/ADSecurity.iss` | Inno Setup script → `ADSecuritySetup.exe` |
| `installer/README.md` | Installer build instructions |
| `installer/templates/config.json.example` | Production config shape |
| `installer/templates/version.json.example` | Version metadata shape |
| `installer/templates/mongod.cfg` | Mongo config template |
| `installer/templates/ADSecurity.API.xml` | WinSW API service definition |
| `installer/templates/ADSecurity.Mongo.xml` | WinSW Mongo service definition |
| `installer/scripts/Configure-ADSecurity.ps1` | Post-install configure + service start + rollback |
| `installer/scripts/Launch-ADSecurity.ps1` | Desktop launcher / browser open |
| `installer/scripts/Repair-ADSecurity.ps1` | Repair services/folders |
| `installer/scripts/Uninstall-ADSecurity.ps1` | Stop/unregister services + remove files |
| `installer/scripts/Wait-MongoReady.ps1` | TCP wait helper for Mongo |
| `installer/app/**/.gitkeep` | Folder contract placeholders |
| `installer/runtime/**/README.md` + `.gitkeep` | Drop zones for Node/Mongo/WinSW binaries |
| `installer/plugins/.gitkeep`, `installer/updater/.gitkeep` | Reserved folders |
| `installer/programdata-skeleton/**` | ProgramData layout contract |
| `scripts/windows/prepare-payload.ps1` | Build & stage offline payload |
| `scripts/windows/write-manifest.ps1` | Write `payload-manifest.json` for staged payload |
| `scripts/windows/ADSecurity-doctor.ps1` | Host diagnostics report |
| `scripts/windows/Backup-Restore-ADSecurity.ps1` | mongodump/mongorestore + config/license copy |
| `scripts/windows/Move-ADSecurity.ps1` | Export/import ProgramData bundle |
| `docs/windows-packaging/INVENTORY.md` | Packaging inventory |
| `docs/windows-packaging/HARDENING.md` | Hardening notes |
| `docs/windows-packaging/DISASTER_RECOVERY.md` | DR procedures |
| `docs/windows-packaging/RELEASE_CHECKLIST.md` | Release / VM verification checklist |

## Explicitly **not** added

- No Electron `main.js` / `preload.js`
- No `electron-builder` / `forge` config
- No single-file Node binary (`pkg` / `nexe`)
- No custom native `.exe` launcher (PowerShell shortcut only)

---

# 4. Backend Startup

## How backend starts

Windows Service Control Manager starts **`ADSecurity.API`** (WinSW). WinSW launches Node against the production dist entry.

## Command executed

From `installer/templates/ADSecurity.API.xml`:

```xml
<executable>%BASE%\..\..\runtime\node\node.exe</executable>
<arguments>"%BASE%\..\..\app\backend\dist\server.js"</arguments>
<workingdirectory>%BASE%\..\..\app\backend</workingdirectory>
```

Resolved typical absolute command:

```text
"C:\Program Files\ADSecurity\runtime\node\node.exe" ^
  "C:\Program Files\ADSecurity\app\backend\dist\server.js"
```

## CWD used

```text
C:\Program Files\ADSecurity\app\backend
```

## Executable path

```text
C:\Program Files\ADSecurity\runtime\node\node.exe
```

## Environment variables (WinSW)

```xml
<env name="NODE_ENV" value="production"/>
<env name="ADSecurity_HOME" value="%BASE%\..\.."/>
<env name="ADSecurity_DATA" value="C:\ProgramData\ADSecurity"/>
```

Effective:

| Variable | Typical value |
|----------|----------------|
| `NODE_ENV` | `production` |
| `ADSecurity_HOME` | `C:\Program Files\ADSecurity` |
| `ADSecurity_DATA` | `C:\ProgramData\ADSecurity` |

Config is then loaded from:

```text
C:\ProgramData\ADSecurity\config\config.json
```

## Expected port

- Default: **8081**
- Host: **0.0.0.0** (from config example / Configure script)
- Actual listen uses `env.port` / `env.host` from `env.js` after config merge

From `server.js`:

```289:293:icm-backend/src/server.js
function listen() {
  return new Promise((resolve, reject) => {
    const server = app.listen(env.port, env.host, () => resolve(server));
    server.on("error", reject);
  });
}
```

Boot sequence excerpt:

```296:328:icm-backend/src/server.js
async function start() {
  const licenseManager = createLicenseManager(env.license);
  setLicenseManager(licenseManager);
  // … license validate or LICENSE_REQUIRED mode …
  console.log("Connecting to MongoDB…");
  await connectDB();
  databaseReady = true;
  // … migrations …
  await listen();
  console.log(`IGA API listening on http://${env.host}:${env.port}`);
```

## Timeout / retry logic

| Stage | Behavior |
|-------|----------|
| Install Mongo wait | Configure script: TCP connect loop, **60 × 1s** |
| Install API health wait | Configure script: `GET /api/health`, **90 × 1s**, timeout 2s per attempt |
| Desktop launcher | **No HTTP health wait** — only `Start-Sleep -Seconds 2` |
| WinSW onfailure | Restart after 10s, then 20s; reset failure window 1 hour |
| Mongo driver | `serverSelectionTimeoutMS: 500000` in `database.js` (very long; install wait is the practical gate) |
| Backend listen | No retry loop — listen errors fail the process; WinSW may restart service |

---

# 5. Frontend Startup

## How frontend starts

**There is no separate frontend process in production.**

1. Build time: Vite produces static files (`icm-frontend/dist` → staged as `app\frontend`).
2. Runtime: Express mounts that folder via `mountSpaStatic(app)`.

```27:51:icm-backend/src/config/spaStatic.js
export function mountSpaStatic(app) {
  if (env.isDev && process.env.SERVE_SPA !== "true") {
    return null;
  }
  const distDir = resolveFrontendDistDir();
  // …
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    // SPA fallback → index.html
    res.sendFile(path.join(distDir, "index.html"), …);
  });
}
```

Production frontend root expected:

```text
C:\Program Files\ADSecurity\app\frontend\index.html
```

## What server is expected

The **same** ADSecurity.API HTTP server (default `http://127.0.0.1:8081`).

## Is Vite running?

**No** in packaged production. Vite is build-time only.

## Is frontend static?

**Yes.** Prebuilt JS/CSS/HTML assets.

## Does it open localhost?

Yes — the launcher opens:

```text
http://127.0.0.1:<config.server.port>/
```

Default port **8081**.

## Why localhost?

- API binds for local service use; Mongo is loopback-only.
- Same-origin SPA uses `VITE_API_BASE_URL=/api` so the browser talks to the same host/port.
- No public cloud URL is required for offline installs.

```1:1:icm-frontend/.env.production
VITE_API_BASE_URL=/api
```

---

# 6. Port Usage

| Port | Who starts it | Who connects | When available |
|------|---------------|--------------|----------------|
| **8081** (default, configurable) | `ADSecurity.API` / Express `app.listen` | Browser, launcher health checks, support tools | After Mongo connect + migrations + `listen()`; install waits up to ~90s |
| **27017** (default Mongo) | `mongod.exe` via `ADSecurity.Mongo` | Backend Mongoose (`mongodb://127.0.0.1:27017`) | Install waits up to ~60s TCP ready; API depends on this service |
| **465** | Not started by installer | Outbound SMTP client only (if configured) | N/A at install |
| **3000** | **Not used in packaged mode** | Dev-only Vite | Dev only |
| **8080** | **Not used by this packaging** | Nothing in packaging scripts | If user opens `:8080`, connection fails unless something else is bound there |

Port selection at install (`Configure-ADSecurity.ps1`):

- Prefer requested port (default 8081).
- If in use, scan `port+1 … port+49` and write the chosen port into `config.json` and registry.

---

# 7. Browser Launch Logic

## Important correction about `:8080`

Packaging code opens **`http://127.0.0.1:$port/`** where `$port` defaults to **8081**, not 8080.

There is **no** packaging file that hardcodes `http://127.0.0.1:8080`.

## File / lines / function

**File:** [`installer/scripts/Launch-ADSecurity.ps1`](installer/scripts/Launch-ADSecurity.ps1)  

**Lines:** 1–24 (entire script; browser open is line 24)

```1:24:installer/scripts/Launch-ADSecurity.ps1
param(
  [string]$DataRoot = "C:\ProgramData\ADSecurity"
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $DataRoot "config\config.json"
$port = 8081

if (Test-Path $configPath) {
  $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
  if ($cfg.server.port) { $port = [int]$cfg.server.port }
}

# Ensure services are running (best-effort)
$winsw = "C:\Program Files\ADSecurity\runtime\winsw"
if (Test-Path $winsw) {
  Push-Location $winsw
  try { & ".\ADSecurity.Mongo.exe" start } catch {}
  try { & ".\ADSecurity.API.exe" start } catch {}
  Pop-Location
  Start-Sleep -Seconds 2
}

Start-Process "http://127.0.0.1:$port/"
```

**Function:** top-level script body (no named function). Invoked by Inno shortcut:

```49:54:installer/ADSecurity.iss
Name: "{group}\Identity Sphere"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Launch-ADSecurity.ps1"""; …
Name: "{commondesktop}\Identity Sphere"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\Launch-ADSecurity.ps1"""; …
```

## Why it opens “immediately”

Because after optional service `start` calls it only waits **2 seconds**, then opens the browser. It does **not**:

- poll `/api/health`
- wait for Mongo
- verify the port is listening
- retry if the page fails

By contrast, **install-time** configuration *does* wait for health (up to 90s). Desktop launch does not reuse that gate.

---

# 8. Installer Contents

## Copied by Inno `[Files]` into `{app}` (`Program Files\ADSecurity`)

| Source (build tree) | Destination |
|---------------------|-------------|
| `installer/payload/app/*` | `{app}\app\` (backend dist, migrations, node_modules, frontend, keys, …) |
| `installer/payload/runtime/*` | `{app}\runtime\` (node, mongodb, winsw binaries if staged) |
| `installer/plugins/*` | `{app}\plugins\` |
| `installer/updater/*` | `{app}\updater\` |
| `templates\ADSecurity.API.xml` | `{app}\runtime\winsw\` |
| `templates\ADSecurity.Mongo.xml` | `{app}\runtime\winsw\` |
| `templates\mongod.cfg` | `{app}\runtime\mongodb\` |
| `scripts\*.ps1` | `{app}\scripts\` |

## Created at install time under ProgramData (not shipped as customer data)

| Path | Contents |
|------|----------|
| `C:\ProgramData\ADSecurity\config\config.json` | Port, Mongo URI, paths (no JWT initially) |
| `C:\ProgramData\ADSecurity\version.json` | Product/schema/runtime versions |
| `…\license\` | Empty until license upload |
| `…\logs\{api,mongo,connector,installer,runtime,updater}` | Log dirs |
| `…\uploads`, `…\mongodb`, `…\backups` | Mutable state |

## Expected payload composition (from prepare-payload)

- `app/backend/dist/` — production server JS
- `app/backend/migrations/`
- `app/backend/package.json`
- `app/backend/node_modules/` — production-only install into payload
- `app/frontend/` — Vite build output
- `app/keys/{kid}/public.pem` — public license keys only
- `runtime/node/`, `runtime/mongodb/`, `runtime/winsw/` — if present under `installer/runtime` / payload

## Intentionally excluded

- Committed `.env` / cloud Mongo credentials
- Private signing keys (`private.pem`)
- Lab scripts (`test.ps1`, `Verify-Wisibility.ps1`)
- Report folders / `test-data` / QA scripts
- Architecture markdown at repo root
- DevDependencies (backend payload uses `--omit=dev`)
- Electron, npm global tools on customer machine
- Customer license file (uploaded post-install)

---

# 9. Runtime Dependencies

| Dependency | How packaging satisfies it |
|------------|----------------------------|
| **Node** | Bundled under `runtime\node\node.exe` (manual drop; not OS-installed) |
| **npm** | **Not required** on customer machine. Build agent uses npm; payload ships prebuilt `node_modules` |
| **MongoDB** | Bundled Community binaries under `runtime\mongodb\` as **internal** component; service name `ADSecurity.Mongo` |
| **PowerShell** | Required for launcher/configure/repair (ships with Windows). Not bundled |
| **VC Runtime** | Not explicitly bundled by packaging scripts; Node/Mongo Windows builds typically need compatible VC++ runtime on the host |
| **OpenSSL** | Not separately packaged; Node/Mongo bring their own crypto stacks |
| **Electron** | Not used |
| **Browser** | Uses whatever default browser is registered on Windows (`Start-Process http://…`) |
| **WinSW** | Bundled renamed wrappers `ADSecurity.API.exe` / `ADSecurity.Mongo.exe` |
| **Inno Setup** | Build-machine only (compiles installer); not installed on customer |

---

# 10. Working Directory

| Concept | Packaged value / behavior |
|---------|---------------------------|
| WinSW API `workingdirectory` | `C:\Program Files\ADSecurity\app\backend` |
| Node `process.cwd()` | Expected to match WinSW working directory above |
| ESM `__dirname` (in dist modules) | Under `…\app\backend\dist\…` (copied from `src`) |
| `ADSecurity_HOME` | `C:\Program Files\ADSecurity` |
| `ADSecurity_DATA` / ProgramData | `C:\ProgramData\ADSecurity` |
| Application path | `{autopf}\ADSecurity` → typically `C:\Program Files\ADSecurity` |
| Resources path | No Electron `resources`; equivalent is `{app}\app` + `{app}\runtime` |
| Temporary path | Windows `%TEMP%` (used by move/export scripts; not primary runtime) |
| UserData path | Not Electron userData; mutable state is **ProgramData** |

## What changes after packaging vs developer machine

| Dev | Packaged |
|-----|----------|
| `npm run dev` + Vite `:3000` | No Vite; SPA from Express |
| `.env` in `icm-backend` | `ProgramData\config\config.json` |
| `node src/server.js` | `node dist/server.js` via WinSW |
| Repo-relative uploads / `.data` | Absolute ProgramData paths |
| Developer Mongo (often remote/TLS) | Local loopback Mongo service |

---

# 11. Startup Timeline

Approximate sequence after desktop shortcut (not millisecond-accurate wall clock; architecture-level):

```
t≈0ms     powershell.exe starts Launch-ADSecurity.ps1
t≈0–50ms  Read config.json → resolve port (default 8081)
t≈50ms    Push-Location winsw; ADSecurity.Mongo.exe start (no-op if already running)
t≈100ms   ADSecurity.API.exe start (no-op if already running)
t≈100ms   Start-Sleep 2000ms  ◄── fixed delay only
t≈2100ms  Start-Process http://127.0.0.1:<port>/
t≈2100ms+ Browser navigates; if API not listening → ERR_CONNECTION_REFUSED

Meanwhile, if API was cold-starting (service start path):
  +0       SCM/WinSW spawn node.exe dist/server.js
  +tens–hundreds ms  Load env/config, JWT ensure
  +?       License validate or enter LICENSE_REQUIRED mode
  +?       mongoose.connect (blocked until Mongo accepts)
  +?       runPendingMigrations()
  +?       app.listen(port)
  +?       seed admin / mark serverReady
  +?       SPA static mount already registered before listen
```

### Install-time timeline (stricter)

```
Configure-ADSecurity.ps1
  → create dirs/config
  → Mongo install+start
  → poll TCP :27017 for up to 60s
  → API install+start
  → poll GET /api/health for up to 90s
  → success or rollback (stop/unregister/delete Program Files)
```

---

# 12. Health Check

| Event | Waits for backend? | Waits for frontend? | Waits for database? | Browser timing |
|-------|--------------------|---------------------|---------------------|----------------|
| **Installer Configure** | Yes — `/api/health` up to 90s | Implicit (same process; health means HTTP is up) | Yes — Mongo TCP up to 60s before API start | Browser not opened by Configure |
| **Desktop Launch** | **No** (only 2s sleep) | **No** | **No** | Opens immediately after 2s |
| **API boot internals** | Listen after DB+migrations | SPA mounted before listen | `connectDB()` before listen | N/A |

**Conclusion:** Browser launch does **not** wait for readiness. Install configuration does.

`/api/health` exists and reports `databaseReady`, `backgroundInitComplete`, `licensed`, `licenseRequiredMode` when healthy.

---

# 13. Logging

| Stream | Location |
|--------|----------|
| API stdout/stderr (WinSW roll-by-size) | `C:\ProgramData\ADSecurity\logs\api\` |
| Mongo WinSW logs | `C:\ProgramData\ADSecurity\logs\mongo\` |
| mongod systemLog | `C:\ProgramData\ADSecurity\logs\mongo\mongod.log` (from cfg) |
| Installer Configure script | `C:\ProgramData\ADSecurity\logs\installer\install-<timestamp>.log` |
| Inno Setup logging | Enabled (`SetupLogging=yes`); Inno default log under user temp / Inno log path |
| Runtime / updater reserved dirs | `logs\runtime`, `logs\updater` (doctor writes under runtime) |
| Electron logs | **N/A** (no Electron) |
| Launcher stdout | Ephemeral PowerShell window (shortcuts often hide this); no dedicated launcher log file |
| Backend `console.log` | Captured by WinSW into API logpath |
| Doctor CLI | `logs\runtime\doctor-<timestamp>.json` |

---

# 14. Failure Analysis

Question framed as: why **`http://127.0.0.1:8080`** shows **“This site can't be reached”**.

Based on this implementation (no fixes applied), ranked most → least likely:

### 1. Wrong port (8080 vs 8081) — **most likely**

Packaging defaults to **8081**. Nothing in the packaging stack listens on **8080**. Opening `:8080` will fail even when the product is healthy on `:8081` (or another conflict-selected port in `config.json`).

### 2. Desktop launcher opens before API is listening

`Launch-ADSecurity.ps1` waits only **2 seconds**, then opens the browser with **no health poll**. Cold start (Mongo + Node + migrations) often exceeds 2 seconds → connection refused.

### 3. `ADSecurity.API` / `ADSecurity.Mongo` not running

Service registration failed, services stopped, WinSW binaries missing, dependency order failed, or rollback left a broken install. Browser then has nothing to connect to.

### 4. API process crash after start (config / Mongo / migrations / Node path)

Examples: missing `runtime\node\node.exe`, bad `ADSecurity_HOME` resolution, Mongo not reachable, migration failure (boot throws), listen `EADDRINUSE` on the configured port.

### 5. Firewall / bind / host mismatch — **least likely among these**

Service binds `0.0.0.0` by default and launcher uses `127.0.0.1`, so local loopback usually works. Still possible if a local security product blocks the port or config was edited to a non-listening host.

---

# 15. Verification Checklist

Use on an installed Windows machine (elevate where needed).

## Backend actually started

- [ ] `Get-Service ADSecurity.API` → `Running`
- [ ] `Get-CimInstance Win32_Process` shows `node.exe` with `dist\server.js` in command line
- [ ] `C:\ProgramData\ADSecurity\logs\api\` has recent log files
- [ ] Log contains `IGA API listening on http://…`

## Frontend actually started

- [ ] `Test-Path "C:\Program Files\ADSecurity\app\frontend\index.html"` → `True`
- [ ] API log contains `[spa] Serving frontend from …\app\frontend`
- [ ] `Invoke-WebRequest http://127.0.0.1:<port>/` returns HTML (not connection error)
- [ ] Confirm **Vite is not** running as a process

## Port listening

- [ ] Read port: `(Get-Content C:\ProgramData\ADSecurity\config\config.json | ConvertFrom-Json).server.port`
- [ ] `Test-NetConnection 127.0.0.1 -Port <port>` → `TcpTestSucceeded : True`
- [ ] `Test-NetConnection 127.0.0.1 -Port 27017` → `True`
- [ ] Do **not** assume 8080

## Browser launched

- [ ] Desktop shortcut targets `powershell.exe` + `Launch-ADSecurity.ps1`
- [ ] Shortcut opens `http://127.0.0.1:<config port>/` (verify address bar)
- [ ] If failure, note whether URL used 8080 incorrectly

## Child processes alive

- [ ] `ADSecurity.Mongo` Running + `mongod.exe` present
- [ ] `ADSecurity.API` Running + `node.exe` present
- [ ] Killing `node.exe` → WinSW restart policy brings it back

## Installer copied files

- [ ] `C:\Program Files\ADSecurity\app\backend\dist\server.js` exists
- [ ] `…\app\backend\node_modules` exists
- [ ] `…\app\frontend\index.html` exists
- [ ] `…\runtime\node\node.exe` exists
- [ ] `…\runtime\mongodb\bin\mongod.exe` exists
- [ ] `…\runtime\winsw\ADSecurity.API.exe` and `.Mongo.exe` exist
- [ ] `…\scripts\Launch-ADSecurity.ps1` exists

## Working directory / executable paths correct

- [ ] Registry `HKLM\Software\Wisbility\ADSecurity\InstallRoot` = Program Files path
- [ ] Registry `DataRoot` = ProgramData path
- [ ] WinSW XML arguments point at `app\backend\dist\server.js` (not `src\server.js`)
- [ ] `ADSecurity_DATA` points at ProgramData
- [ ] `config.json` paths are absolute under ProgramData

---

# OVERALL PACKAGING STATUS

## **FAIL**

### Why

The packaging **architecture and code/scripts are substantially implemented** (Inno Setup installer, WinSW services, bundled Node/Mongo drop zones, Express-served SPA, ProgramData `config.json`, license hot-reload, prepare-payload), but this audit cannot classify the product as a **verified, shippable Windows package** for these reasons:

1. **No Electron / no single app EXE runtime** — the “product EXE” is an **installer**; day-to-day entry is **PowerShell + browser**, which is easy to misread as a failed native app package.
2. **Desktop launch is race-prone** — browser opens after a fixed **2s** sleep with **no health gate**, a primary cause of “site can’t be reached”.
3. **Port confusion is built into operator expectation** — people probe **`:8080`**, while packaging defaults to **`:8081`** (or another conflict-selected port). The failure mode in section 14 is therefore highly likely even on a healthy install.
4. **End-to-end proof is incomplete in this audit** — payload staging was observed partially successful earlier; clean-VM install success of `ADSecuritySetup.exe` with both services healthy and UI reachable was **not** demonstrated as a completed, signed-off verification here.
5. **Customer host prerequisites remain external** — Node/Mongo/WinSW binaries must be correctly dropped and staged; VC++ runtime and PowerShell execution policy issues can still break first run.

### What *did* pass (implementation scope)

- Production config path (`config.json`, not `.env`)
- SPA served by Express
- Dist entrypoint (`dist/server.js`) for services
- Service names, Program Files vs ProgramData separation
- Install-time Mongo/API health waits + rollback script support
- License-required minimal mode + admin license UI/API

---

*End of report. No application code was modified while producing this document.*
