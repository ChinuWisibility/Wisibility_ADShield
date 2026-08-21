import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { base64UrlEncode } from "../base64Url.js";

export const DEFAULT_KID = "key-2026-01";
export const DEFAULT_ISSUER = "Wisibility";
export const DEFAULT_AUDIENCE = "ADSecurity";
export const DEFAULT_PRODUCT = "ADSecurity";

/**
 * Generates an RSA-2048 key pair for tests.
 * @returns {{ privateKey: string, publicKey: string, kid: string }}
 */
export function generateTestKeyPair(kid = DEFAULT_KID) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey, kid };
}

/**
 * @param {object} [overrides]
 */
export function buildClaims(overrides = {}) {
  const now = Date.now();
  return {
    schema: "1.0",
    id: "550e8400-e29b-41d4-a716-446655440000",
    licenseId: "LIC-TEST-001",
    iss: DEFAULT_ISSUER,
    aud: DEFAULT_AUDIENCE,
    type: "Commercial",
    customer: {
      code: "CUST-ACME",
      name: "Acme Corp",
      email: "ops@acme.example",
    },
    product: {
      code: DEFAULT_PRODUCT,
      name: "Identity Sphere",
    },
    edition: "Professional",
    features: ["FEAT_IGA", "FEAT_ADSPM"],
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/**
 * Signs a license container using the LMS contract:
 * Base64URL(JSON) payload, RSA-SHA256 over the payload string, Base64URL signature.
 *
 * @param {object} claims
 * @param {string} privateKeyPem
 * @param {object} [containerOverrides]
 */
export function buildSignedLicense(claims, privateKeyPem, containerOverrides = {}) {
  const payloadJson = JSON.stringify(claims);
  const payload = base64UrlEncode(payloadJson);
  const signature = base64UrlEncode(
    crypto.sign("RSA-SHA256", Buffer.from(payload, "utf8"), privateKeyPem),
  );

  return {
    version: 1,
    alg: "RS256",
    hash: "SHA-256",
    kid: DEFAULT_KID,
    payload,
    signature,
    ...containerOverrides,
  };
}

/**
 * Creates a temp app root with keys/{kid}/public.pem and optional license file.
 */
export async function createTempLicenseLayout({
  publicKeyPem,
  kid = DEFAULT_KID,
  licenseContainer = null,
  licenseRelativePath = "config/license.lic.json",
} = {}) {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "iga-license-"));
  const keysDir = path.join(appRoot, "keys");
  const kidDir = path.join(keysDir, kid);
  await fs.mkdir(kidDir, { recursive: true });
  await fs.writeFile(path.join(kidDir, "public.pem"), publicKeyPem, "utf8");

  let licensePath = null;
  if (licenseContainer) {
    licensePath = path.join(appRoot, licenseRelativePath);
    await fs.mkdir(path.dirname(licensePath), { recursive: true });
    await fs.writeFile(licensePath, JSON.stringify(licenseContainer), "utf8");
  }

  return { appRoot, keysDir, licensePath };
}

export function baseLicenseConfig(appRoot, keysDir, overrides = {}) {
  return {
    appRoot,
    searchPaths: ["config/license.lic.json", "license/license.lic.json"],
    envFilePath: "",
    envContent: "",
    keysDir,
    issuer: DEFAULT_ISSUER,
    audience: DEFAULT_AUDIENCE,
    expectedProduct: DEFAULT_PRODUCT,
    schemaVersion: "1.0",
    allowedAlgorithms: ["RS256"],
    allowedHashes: ["SHA-256"],
    allowedTypes: [
      "Commercial",
      "Trial",
      "Evaluation",
      "Educational",
      "Internal",
      "development",
    ],
    ...overrides,
  };
}
