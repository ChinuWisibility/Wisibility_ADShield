#!/usr/bin/env node
/**
 * Generate a local RSA key + signed license for development / offline install smoke tests.
 * Matches LMS LICENSE_ARTIFACT.md (Base64URL, schema 1.0, keys/{kid}/public.pem).
 *
 * Usage (from icm-backend):
 *   node scripts/generateLocalLicense.mjs
 *
 * Writes:
 *   keys/key-2026-01/public.pem
 *   config/license.lic.json
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const kid = process.env.LICENSE_KID || "key-2026-01";
const writePrivate = process.argv.includes("--write-private");

const issuer = process.env.LICENSE_ISSUER || "Wisibility";
const audience = process.env.LICENSE_AUDIENCE || "ADSecurity";
const productCode = process.env.LICENSE_PRODUCT || audience;
const customer = process.env.LICENSE_CUSTOMER || "Local Development";
const days = parseInt(process.env.LICENSE_VALID_DAYS || "365", 10);

function base64UrlEncode(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const now = Date.now();
const claims = {
  schema: "1.0",
  id: crypto.randomUUID(),
  licenseId: `LIC-LOCAL-${Date.now()}`,
  iss: issuer,
  aud: audience,
  type: "development",
  customer: {
    code: "CUST-LOCAL",
    name: customer,
    email: "dev@localhost",
  },
  product: {
    code: productCode,
    name: "Identity Sphere",
  },
  edition: "Professional",
  features: [],
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
};

const payload = base64UrlEncode(JSON.stringify(claims));
const signature = base64UrlEncode(
  crypto.sign("RSA-SHA256", Buffer.from(payload, "utf8"), privateKey),
);

const container = {
  version: 1,
  alg: "RS256",
  hash: "SHA-256",
  kid,
  payload,
  signature,
};

const kidDir = path.join(appRoot, "keys", kid);
const configDir = path.join(appRoot, "config");
await fs.mkdir(kidDir, { recursive: true });
await fs.mkdir(configDir, { recursive: true });

await fs.writeFile(path.join(kidDir, "public.pem"), publicKey, "utf8");
await fs.writeFile(
  path.join(configDir, "license.lic.json"),
  JSON.stringify(container, null, 2),
  "utf8",
);

if (writePrivate) {
  await fs.writeFile(path.join(kidDir, "private.pem"), privateKey, "utf8");
}

// Clean obsolete flat layout from earlier iterations
try {
  await fs.unlink(path.join(appRoot, "keys", `${kid}.pub`));
} catch {
  /* ignore */
}

console.log(`Wrote keys/${kid}/public.pem`);
console.log("Wrote config/license.lic.json");
console.log(`License ID: ${claims.licenseId}`);
console.log(`Expires: ${claims.expiresAt}`);
if (!writePrivate) {
  console.log("Private key was not written (pass --write-private to persist it).");
}
