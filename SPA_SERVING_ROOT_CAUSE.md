# SPA Serving Root Cause

**Verdict:** Packaging successfully placed the React build under `C:\Program Files\ADSecurity\app\frontend\` (including `index.html`). Express is **not** serving it because `mountSpaStatic(app)` **returns early without registering any SPA middleware**. The process that answered `GET /` was running with `env.isDev === true` (and `SERVE_SPA` unset), so the SPA mount is skipped. `GET /` therefore falls through to the API `notFound` middleware, which returns exactly the JSON you observed.

No code was changed for this investigation.

---

## Evidence summary

| Check | Result |
| --- | --- |
| `GET /` body | `{ success:false, error:{ code:"NOT_FOUND", message:"Route GET / not found" } }` |
| Handler that produces that body | `notFound` in `icm-backend/src/middleware/errorHandler.js` |
| Frontend on disk after install | **Present** at `C:\Program Files\ADSecurity\app\frontend\` |
| `index.html` after install | **Present** (1143 bytes) |
| `assets/` after install | **Present** (entry/chunks/static/workers) |
| WinSW API service installed | **No** — wrapper log: `The specified service does not exist as an installed service.` |
| `C:\ProgramData\ADSecurity\config\config.json` | **Missing** (Configure did not complete) |
| Intended production env from WinSW XML | `NODE_ENV=production`, `ADSecurity_HOME`, `ADSecurity_DATA` — **never applied** because the service was never installed |

---

## Answers to the investigation questions

### 1. Is `mountSpaStatic(app)` actually being called?

**Yes — the call site runs.**

In both source and installed dist:

```282:286:icm-backend/src/server.js
// Production SPA (after API routes). Dev keeps Vite proxy unless SERVE_SPA=true.
mountSpaStatic(app);

// Error handling
app.use(notFound);
```

Installed: `C:\Program Files\ADSecurity\app\backend\dist\server.js` line ~283.

“Called” ≠ “mounted.” The function is invoked, then often exits immediately without registering middleware (see Q2).

### 2. Is it skipped because `env.isDev` is true?

**Yes — that is the primary root cause for the observed `NOT_FOUND`.**

```27:30:icm-backend/src/config/spaStatic.js
export function mountSpaStatic(app) {
  if (env.isDev && process.env.SERVE_SPA !== "true") {
    return null;
  }
```

`env.isDev` is derived as:

```77:78:icm-backend/src/config/env.js
  nodeEnv: process.env.NODE_ENV || (useProductionConfig ? "production" : "development"),
  isDev: (process.env.NODE_ENV || (useProductionConfig ? "production" : "development")) !== "production",
```

Runtime facts on this machine:

- WinSW services were **not** installed → WinSW’s `<env name="NODE_ENV" value="production"/>` was **not** injected.
- `config.json` under ProgramData is **missing** → `useProductionConfig === false`.
- Therefore, with `NODE_ENV` unset: `nodeEnv = "development"`, `isDev = true`, `SERVE_SPA` unset → **early `return null`**.
- When this happens, `resolveFrontendDistDir()` is **never called**, `express.static` is **not** mounted, and the SPA `app.get("*")` catch-all is **not** registered.

Simulated against the installed tree (bare start, no env):

```text
isDev: true
earlyReturn: true
resolveFrontendDistDir: (not called — isDev skip)
expressStaticMounted: false
spaCatchAllRegistered: false
GET / handler: notFound (API 404 JSON)
```

### 3. What is `resolveFrontendDistDir()` returning at runtime?

**Under the failing start mode: it is not evaluated** (see Q2).

If the isDev gate were bypassed (`NODE_ENV=production` or `SERVE_SPA=true`) with a correct home, it would return:

`C:\Program Files\ADSecurity\app\frontend`

Candidate order:

1. `{home}/app/frontend`
2. `{packageRoot}/../icm-frontend/dist`
3. `{packageRoot}/frontend`

With bare start (`home = packageRoot = …\app\backend`), all three miss `index.html` and the function would return `null` — but that path is secondary because the isDev early-return happens first.

### 4. Does that directory exist after installation?

**Yes.**

`C:\Program Files\ADSecurity\app\frontend\` exists.

### 5. Does `index.html` exist there?

**Yes.**

`C:\Program Files\ADSecurity\app\frontend\index.html` exists.

Also present: `assets\` (with `entry\`, `chunks\`, `static\`, workers) and `lottie\`.

### 6. Is `express.static()` successfully mounted?

**No — not in the failing process.**

`express.static(distDir, { index: false, maxAge: "1h" })` only runs after the isDev check and a non-null `distDir`. Both failed gates leave static unmounted.

Note: even when mounted, `index: false` means static alone does **not** map `GET /` → `index.html`; the SPA catch-all is required for `/`.

### 7. Is the SPA middleware registered before or after the API 404 middleware?

**Intended order: SPA before 404.**

Registration sequence at the end of `server.js`:

1. `mountSpaStatic(app)` — would add `express.static` + `app.get("*")`
2. `app.use(notFound)` — API JSON 404
3. `app.use(errorHandler)`

So SPA is **supposed to be before** `notFound`. In the failing run, SPA layers are absent, so `notFound` is the first terminal handler for `GET /`.

### 8. Is the catch-all route (`*` / `/*`) ever reached?

**No — not in the failing process.**

The catch-all only exists inside `mountSpaStatic` after a successful dist resolve:

```41:51:icm-backend/src/config/spaStatic.js
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
      return next();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    res.sendFile(path.join(distDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
```

Because of the isDev early-return, this route is never registered, so it is never reached.

### 9. Complete Express middleware registration order

From `icm-backend/src/server.js` (installed dist matches):

1. `trust proxy` (conditional)
2. `helmet(...)`
3. `cors(corsOptions)`
4. `compression()`
5. `express.json({ limit: "100mb" })`
6. `express.urlencoded({ extended: true })`
7. `morgan(...)`
8. `apiLimiter`
9. `auditTrail`
10. DB-ready gate middleware (503 for `/api/*` while starting; non-API `next()`)
11. License-required gate middleware (API-only)
12. `GET /api/health`
13. `/api/license`, `/api/system`
14. All other `/api/*` routers (auth, applications, identities, …, hrms)
15. `/uploads` (+ CORP header + `express.static(uploadsAbs)`)
16. More `/api/*` (branding, logos, preferences, dashboard, jobs, hrms) — note some API mounts after uploads
17. **`mountSpaStatic(app)`** → *when successful:*  
    17a. `express.static(frontendDist, { index: false })`  
    17b. `GET *` SPA HTML fallback  
    → *when skipped / dist missing:* nothing added
18. `notFound` ← **this handled `GET /`**
19. `errorHandler`

### 10. Which middleware handles `GET /`?

**`notFound`** (`icm-backend/src/middleware/errorHandler.js`):

```29:34:icm-backend/src/middleware/errorHandler.js
export function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}
```

That string is a fingerprint: only this middleware emits `Route GET / not found`.

---

## Install-tree verification: `C:\Program Files\ADSecurity\app\frontend\`

| Item | Present? |
| --- | --- |
| `index.html` | Yes |
| `assets\` | Yes |
| `lottie\` | Yes |
| Favicon (`icm-favicon.svg` / `.ico`) at frontend root | **No** |
| `manifest` / `.webmanifest` at frontend root | **No** |

`index.html` references `/icm-favicon.svg`, but that file is not in the installed frontend tree. Workspace `icm-frontend/public` currently contains only `lottie\` — so a normal Vite copy-from-public step would not emit a favicon either. **This is unrelated to the JSON `NOT_FOUND` on `GET /`.** Missing favicon would be a 404 on `/icm-favicon.svg` *after* HTML was served.

### Did packaging fail to copy the SPA?

**No.** `prepare-payload.ps1` stages frontend correctly:

```text
Copy-Item (Join-Path $frontendDist "*") (Join-Path $OutDir "app\frontend") -Recurse -Force
```

On-disk install contents prove that step succeeded for the built dist (HTML + assets + lottie).

---

## Why Express is not serving an existing frontend

Causal chain for the observed failure:

```text
Process started without NODE_ENV=production
  AND without a discoverable production config.json
    → env.isDev === true
      → mountSpaStatic() returns null immediately
        → no express.static, no GET *
          → GET / reaches notFound
            → JSON NOT_FOUND
```

Why production env was missing on this machine:

1. `Configure-ADSecurity.ps1` / WinSW install did **not** successfully register services (wrapper FATAL: service does not exist).
2. Without the WinSW service, these env vars from `ADSecurity.API.xml` are never set:

```xml
<env name="NODE_ENV" value="production"/>
<env name="ADSecurity_HOME" value="%BASE%\..\.."/>
<env name="ADSecurity_DATA" value="C:\ProgramData\ADSecurity"/>
```

3. Path resolution **also** depends on `NODE_ENV` / `ADSecurity_*` to find ProgramData config:

```24:34:icm-backend/src/config/productPaths.js
  const home = process.env.ADSecurity_HOME
    ? path.resolve(process.env.ADSecurity_HOME)
    : process.env.NODE_ENV === "production"
      ? defaultHome
      : PACKAGE_ROOT;

  const data = process.env.ADSecurity_DATA
    ? path.resolve(process.env.ADSecurity_DATA)
    : process.env.NODE_ENV === "production"
      ? defaultData
      : path.join(PACKAGE_ROOT, ".data");
```

Bare start therefore looks for config under `…\app\backend\.data\…` (absent), never loads ProgramData config, and stays in “development” SPA-disabled mode even if frontend files sit correctly under Program Files.

### Counterfactual (what would serve the SPA)

Simulated with intended WinSW env against the **same** installed frontend:

```text
NODE_ENV=production
ADSecurity_HOME=C:\Program Files\ADSecurity
→ isDev: false
→ resolveFrontendDistDir: C:\Program Files\ADSecurity\app\frontend
→ express.static + GET * registered
→ GET / would be served as index.html
```

`NODE_ENV=production` alone (no HOME override) also resolves home to Program Files and finds the frontend.

### Secondary failure mode (not required to explain current evidence, but real)

If `NODE_ENV=production` but `ADSecurity_HOME` is the **literal** unexpanded string `%BASE%\..\..` (cwd = `…\app\backend`), home normalizes to `…\ADSecurity\app`, and candidates become:

- `…\app\app\frontend` — missing  
- `…\app\icm-frontend\dist` — missing  
- `…\app\backend\frontend` — missing  

Then: isDev gate passes, but `resolveFrontendDistDir()` returns `null`, logs `[spa] Frontend dist not found — API-only mode`, and `GET /` still hits `notFound`.

---

## Related install observations (not the SPA root cause, but relevant)

| Observation | Detail |
| --- | --- |
| ProgramData | Only `logs\` present; no `config\`, `license\`, etc. |
| API/Mongo Windows services | Not installed |
| `app\backend\node_modules` | Directory exists but is **empty** at investigation time (no `express` / `dotenv`) — a separate packaging/install defect that would prevent a cold start from Program Files *now*; it does not change the SPA logic that produces `NOT_FOUND` when the API *is* running |

---

## Root cause (one sentence)

**The React files are on disk; Express never mounts them because `mountSpaStatic` deliberately no-ops whenever `env.isDev` is true and `SERVE_SPA` is not `"true"`, and the packaged process that returned `NOT_FOUND` was in that state (WinSW production env not applied / production config not loaded).**

---

## What would confirm this on a live process (no code changes)

1. `GET /api/health` → `data.environment` should be `"development"` in the failing mode, `"production"` when SPA can mount via `NODE_ENV`.
2. Process environment: absence of `NODE_ENV=production` (or presence without expanded `ADSecurity_HOME` for the secondary mode).
3. Stdout: absence of `[spa] Serving frontend from …`; possible presence of nothing SPA-related (isDev skip has no log) or `[spa] Frontend dist not found — API-only mode` (dist-null mode).
