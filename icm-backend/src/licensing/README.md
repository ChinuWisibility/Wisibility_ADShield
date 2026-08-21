# Identity Sphere — Offline License Validation

Enterprise product licensing for Identity Sphere. Validation is **offline**, performed
**only on the backend**, and **blocks startup** when the license is invalid.

Compatible with the production LMS artifact format documented in `LICENSE_ARTIFACT.md`
(format version 1, payload schema `1.0`, Base64URL, RS256).

The React frontend never validates licenses.

---

## Architecture overview

```
icm-backend/src/licensing/
├── LicenseManager.js          # Sole public entry point (validate)
├── LicenseLoader.js           # Locate + read license container
├── LicenseVerifier.js         # Orchestrate crypto + claims pipeline
├── SignatureVerifier.js       # RS256 over Base64URL payload string
├── ClaimsValidator.js         # Schema, iss, aud, expiry, mandatory claims
├── PublicKeyProvider.js       # Load keys/{kid}/public.pem dynamically
├── LicenseRepository.js       # In-memory validated license context
├── LicenseValidationResult.js # Immutable success result
├── base64Url.js               # LMS-compatible Base64URL codec
├── exceptions/                # Precise failure types
└── index.js                   # Public exports
```

No other module should depend on loaders/verifiers directly. Use:

```js
import { createLicenseManager } from "./licensing/index.js";
await createLicenseManager(env.license).validate();
```

---

## Startup sequence

```
Backend process starts
  → Module load (Express app wired in memory; not listening)
  → start()
      → LicenseManager.validate()     ★ gate
      → connectDB()
      → app.listen()
      → seeds / workers
```

Integration point: `icm-backend/src/server.js` → first statements inside `async function start()`.

On failure:

1. Internal reason logged (`[License] Validation failure`)
2. `[License] Startup blocked`
3. Process exits with code `1`
4. Public message only: `License validation failed.`
5. No MongoDB connection, no HTTP listen, no API routes reachable

---

## Class responsibilities

| Class | Responsibility |
|-------|----------------|
| **LicenseManager** | Facade: load → verify → log → store. Only public API. |
| **LicenseLoader** | Search-order discovery; parse JSON; treat input as untrusted. |
| **LicenseVerifier** | Container shape, decode payload, integrity, delegate crypto/claims. |
| **SignatureVerifier** | Allowed alg/hash; Base64URL checks; `crypto.verify('RSA-SHA256', …)`. |
| **ClaimsValidator** | Mandatory claims, schema `1.0`, issuer, audience, product code, expiry. |
| **PublicKeyProvider** | Resolve public key by `kid`; unknown kid fails. |
| **LicenseRepository** | Holds validated result for future enforcement/telemetry. |
| **LicenseValidationResult** | Safe summary (id, customer, edition, expiry, iss, aud). |
| **\*Exception** | Precise internal reason; safe public `message`. |

---

## Dependency graph

```
server.js
  └── LicenseManager
        ├── LicenseLoader
        ├── LicenseVerifier
        │     ├── PublicKeyProvider
        │     ├── SignatureVerifier
        │     └── ClaimsValidator
        └── LicenseRepository
```

---

## Configuration guide

Configured via `icm-backend/src/config/env.js` (`env.license`) and environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `LICENSE_SEARCH_PATHS` | Comma-separated relative paths | `config/license.lic.json,license/license.lic.json` |
| `LICENSE_PATH` | Explicit file path (fallback) | _(empty)_ |
| `LICENSE_CONTENT` | Inline license JSON (fallback) | _(empty)_ |
| `LICENSE_KEYS_DIR` | Directory of public keys | `./keys` |
| `LICENSE_ISSUER` | Expected `iss` claim | `Wisibility` |
| `LICENSE_AUDIENCE` | Expected `aud` (LMS product code) | `ADSecurity` |
| `LICENSE_PRODUCT` | Expected `product.code` | same as audience |
| `LICENSE_SCHEMA_VERSION` | Expected payload `schema` | `1.0` |
| `LICENSE_ALLOWED_ALGS` | Allowed container `alg` | `RS256` |
| `LICENSE_ALLOWED_HASHES` | Allowed container `hash` | `SHA-256` |
| `LICENSE_ALLOWED_TYPES` | Allowed `type` values | Commercial, Trial, … |

**There is no environment flag to disable licensing.**

Align `LICENSE_ISSUER` / `LICENSE_AUDIENCE` with the values the LMS embeds when issuing the Identity Sphere license.

---

## License lookup order

1. Each path in `LICENSE_SEARCH_PATHS` under the backend app root
2. `LICENSE_PATH` (file)
3. `LICENSE_CONTENT` (inline JSON)

First successful read wins. Missing all candidates → `MissingLicenseException`.

---

## Public key resolution

For container `kid` (e.g. `key-2026-01`):

1. `{keysDir}/{kid}/public.pem` ← LMS layout
2. `{keysDir}/{kid}.pub`
3. `{keysDir}/public.pem` ← legacy flat layout

---

## Validation pipeline

1. Locate license
2. Read + parse JSON container
3. Assert container fields (`version`, `alg`, `hash`, `kid`, `payload`, `signature`)
4. Load public key for `kid`
5. Verify RS256 signature over UTF-8 bytes of the Base64URL `payload` string
6. Decode Base64URL payload → JSON claims (schema `1.0`)
7. Validate issuer / audience / product.code / type / mandatory claims
8. Validate expiry (`expiresAt` > now)
9. Persist `LicenseValidationResult` and continue startup

LMS signing contract:

```
payload   = Base64URL( JSON claims )
signature = Base64URL( RSA-SHA256( UTF-8(payload) ) )
```

Payload claims (schema 1.0): `customer` and `product` are objects (`{code,name,…}`).

---

## Logging (safe)

Logged on success: License loaded, License ID, Customer, Edition, Expiry, Issuer, Audience, Validation success.

Logged on failure: Validation failure (internal reason), Startup blocked.

**Never logged:** payload, signature, decoded license body, public/private keys.

---

## Failure scenarios

| Scenario | Exception |
|----------|-----------|
| File missing | `MissingLicenseException` |
| Corrupted / malformed JSON | `InvalidLicenseException` |
| Missing payload / signature / claims | `InvalidLicenseException` |
| Invalid Base64URL | `InvalidLicenseException` |
| Wrong / unsupported algorithm | `UnsupportedAlgorithmException` |
| Wrong / unsupported hash | `UnsupportedHashException` |
| Unknown `kid` / missing public key | `PublicKeyNotFoundException` |
| Bad signature / tampered payload | `InvalidSignatureException` |
| Wrong issuer | `InvalidIssuerException` |
| Wrong audience | `InvalidAudienceException` |
| Wrong schema | `InvalidSchemaException` |
| Expired | `ExpiredLicenseException` |

---

## Local / smoke-test license

For development only (LMS remains the production issuer):

```bash
cd icm-backend
node scripts/generateLocalLicense.mjs
```

Writes `keys/{kid}/public.pem` and `config/license.lic.json` using the LMS signing contract.

---

## Deployment checklist

1. Place LMS-issued `*.lic.json` under `icm-backend/config/` (or `license/`)
2. Copy the matching LMS public key to `icm-backend/keys/{kid}/public.pem`
3. Set `LICENSE_ISSUER` / `LICENSE_AUDIENCE` / `LICENSE_PRODUCT` to match the issued claims
4. Start backend — must log Validation success before MongoDB connect

---

## Future extension points

Designed for later addition **without redesign** (not implemented today):

- Feature enforcement — `LicenseManager.isFeatureEnabled()` currently returns true iff licensed
- Edition enforcement — `edition` claim already stored on `LicenseValidationResult`
- Concurrent seat validation — extend `LicenseRepository`
- Offline / online activation — new strategies behind `LicenseLoader`
- Renewal / revocation / grace periods — extend `ClaimsValidator` + repository
- Usage telemetry — observe `LicenseRepository.get()` after boot

Current business rule: Identity Sphere is one complete product → **VALID** or **INVALID** only.
