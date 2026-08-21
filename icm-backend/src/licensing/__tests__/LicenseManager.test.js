import fs from "fs/promises";
import path from "path";
import { LicenseManager } from "../LicenseManager.js";
import { LicenseLoader } from "../LicenseLoader.js";
import { ClaimsValidator } from "../ClaimsValidator.js";
import { SignatureVerifier } from "../SignatureVerifier.js";
import {
  MissingLicenseException,
  InvalidLicenseException,
  InvalidSignatureException,
  InvalidAudienceException,
  InvalidIssuerException,
  ExpiredLicenseException,
  UnsupportedAlgorithmException,
  UnsupportedHashException,
  PublicKeyNotFoundException,
  InvalidSchemaException,
  LicenseException,
} from "../exceptions/index.js";
import {
  generateTestKeyPair,
  buildClaims,
  buildSignedLicense,
  createTempLicenseLayout,
  baseLicenseConfig,
  DEFAULT_KID,
} from "../testSupport/licenseTestUtils.js";

describe("LicenseManager validation scenarios", () => {
  /** @type {string[]} */
  const tempRoots = [];

  afterEach(async () => {
    while (tempRoots.length) {
      const root = tempRoots.pop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  async function setupValid({ claimsOverrides = {}, containerOverrides = {}, configOverrides = {} } = {}) {
    const keys = generateTestKeyPair();
    const claims = buildClaims(claimsOverrides);
    const container = buildSignedLicense(claims, keys.privateKey, containerOverrides);
    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      kid: keys.kid,
      licenseContainer: container,
    });
    tempRoots.push(layout.appRoot);

    const manager = new LicenseManager(
      baseLicenseConfig(layout.appRoot, layout.keysDir, configOverrides),
    );
    return { manager, keys, claims, container, layout };
  }

  test("Valid License", async () => {
    const { manager } = await setupValid();
    const result = await manager.validate();
    expect(result.valid).toBe(true);
    expect(result.licenseId).toBe("LIC-TEST-001");
    expect(manager.isLicensed()).toBe(true);
    expect(manager.isFeatureEnabled("anything")).toBe(true);
  });

  test("Missing License", async () => {
    const keys = generateTestKeyPair();
    const layout = await createTempLicenseLayout({ publicKeyPem: keys.publicKey });
    tempRoots.push(layout.appRoot);

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(MissingLicenseException);
  });

  test("Expired License", async () => {
    const { manager } = await setupValid({
      claimsOverrides: {
        issuedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-12-31T00:00:00.000Z",
      },
    });
    await expect(manager.validate()).rejects.toBeInstanceOf(ExpiredLicenseException);
  });

  test("Modified Payload", async () => {
    const keys = generateTestKeyPair();
    const claims = buildClaims();
    const container = buildSignedLicense(claims, keys.privateKey);
    const { base64UrlEncode } = await import("../base64Url.js");
    const tamperedClaims = {
      ...claims,
      customer: { ...claims.customer, name: "Attacker Inc" },
    };
    container.payload = base64UrlEncode(JSON.stringify(tamperedClaims));

    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      licenseContainer: container,
    });
    tempRoots.push(layout.appRoot);

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidSignatureException);
  });

  test("Modified Signature", async () => {
    const keys = generateTestKeyPair();
    const container = buildSignedLicense(buildClaims(), keys.privateKey);
    const { base64UrlEncode, base64UrlDecode } = await import("../base64Url.js");
    const sigBuf = Buffer.from(base64UrlDecode(container.signature));
    sigBuf[0] ^= 0xff;
    container.signature = base64UrlEncode(sigBuf);

    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      licenseContainer: container,
    });
    tempRoots.push(layout.appRoot);

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidSignatureException);
  });

  test("Wrong Issuer", async () => {
    const { manager } = await setupValid({
      claimsOverrides: { iss: "Evil Issuer" },
    });
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidIssuerException);
  });

  test("Wrong Audience", async () => {
    const { manager } = await setupValid({
      claimsOverrides: { aud: "Other Product" },
    });
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidAudienceException);
  });

  test("Unknown kid", async () => {
    const { manager } = await setupValid({
      containerOverrides: { kid: "key-unknown-99" },
    });
    await expect(manager.validate()).rejects.toBeInstanceOf(PublicKeyNotFoundException);
  });

  test("Corrupted JSON", async () => {
    const keys = generateTestKeyPair();
    const layout = await createTempLicenseLayout({ publicKeyPem: keys.publicKey });
    tempRoots.push(layout.appRoot);
    const licensePath = path.join(layout.appRoot, "config", "license.lic.json");
    await fs.mkdir(path.dirname(licensePath), { recursive: true });
    await fs.writeFile(licensePath, "{not-json", "utf8");

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidLicenseException);
  });

  test("Invalid Base64 payload", async () => {
    const keys = generateTestKeyPair();
    const container = buildSignedLicense(buildClaims(), keys.privateKey);
    container.payload = "!!!not-base64url!!!";

    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      licenseContainer: container,
    });
    tempRoots.push(layout.appRoot);

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidLicenseException);
  });

  test("Wrong Algorithm", async () => {
    const { manager } = await setupValid({
      containerOverrides: { alg: "HS256" },
    });
    // Signature still present but alg rejected before/during verify
    await expect(manager.validate()).rejects.toBeInstanceOf(UnsupportedAlgorithmException);
  });

  test("Wrong Hash", async () => {
    const { manager } = await setupValid({
      containerOverrides: { hash: "SHA-512" },
    });
    await expect(manager.validate()).rejects.toBeInstanceOf(UnsupportedHashException);
  });

  test("Missing Public Key", async () => {
    const keys = generateTestKeyPair();
    const container = buildSignedLicense(buildClaims(), keys.privateKey);
    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      licenseContainer: container,
    });
    tempRoots.push(layout.appRoot);
    await fs.rm(path.join(layout.keysDir, DEFAULT_KID), { recursive: true, force: true });

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(PublicKeyNotFoundException);
  });

  test("Missing Claims", async () => {
    const keys = generateTestKeyPair();
    const claims = buildClaims();
    delete claims.licenseId;
    const container = buildSignedLicense(claims, keys.privateKey);
    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      licenseContainer: container,
    });
    tempRoots.push(layout.appRoot);

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    await expect(manager.validate()).rejects.toBeInstanceOf(InvalidLicenseException);
  });

  test("exceptions expose safe public message only", async () => {
    const err = new MissingLicenseException("secret path /opt/secrets/license.lic.json");
    expect(err.message).toBe("License validation failed.");
    expect(err.internalReason).toContain("secret path");
    expect(err).toBeInstanceOf(LicenseException);
  });

  test("license lookup prefers config/ over license/", async () => {
    const keys = generateTestKeyPair();
    const first = buildSignedLicense(buildClaims({ licenseId: "FROM-CONFIG" }), keys.privateKey);
    const second = buildSignedLicense(buildClaims({ licenseId: "FROM-LICENSE-DIR" }), keys.privateKey);
    const layout = await createTempLicenseLayout({
      publicKeyPem: keys.publicKey,
      licenseContainer: first,
      licenseRelativePath: "config/license.lic.json",
    });
    tempRoots.push(layout.appRoot);
    const alt = path.join(layout.appRoot, "license", "license.lic.json");
    await fs.mkdir(path.dirname(alt), { recursive: true });
    await fs.writeFile(alt, JSON.stringify(second), "utf8");

    const manager = new LicenseManager(baseLicenseConfig(layout.appRoot, layout.keysDir));
    const result = await manager.validate();
    expect(result.licenseId).toBe("FROM-CONFIG");
  });

  test("LICENSE_PATH env fallback when search paths miss", async () => {
    const keys = generateTestKeyPair();
    const container = buildSignedLicense(buildClaims({ licenseId: "FROM-ENV-PATH" }), keys.privateKey);
    const layout = await createTempLicenseLayout({ publicKeyPem: keys.publicKey });
    tempRoots.push(layout.appRoot);
    const customPath = path.join(layout.appRoot, "custom", "prod.lic.json");
    await fs.mkdir(path.dirname(customPath), { recursive: true });
    await fs.writeFile(customPath, JSON.stringify(container), "utf8");

    const manager = new LicenseManager(
      baseLicenseConfig(layout.appRoot, layout.keysDir, { envFilePath: customPath }),
    );
    const result = await manager.validate();
    expect(result.licenseId).toBe("FROM-ENV-PATH");
  });
});

describe("ClaimsValidator", () => {
  test("rejects wrong schema", () => {
    const validator = new ClaimsValidator({
      expectedSchemaVersion: "1.0",
      issuer: "Wisibility",
      audience: "ADSecurity",
    });
    expect(() => validator.validate(buildClaims({ schema: "99.0" }))).toThrow(
      InvalidSchemaException,
    );
  });
});

describe("LicenseLoader", () => {
  test("reads LICENSE_CONTENT when files absent", async () => {
    const keys = generateTestKeyPair();
    const container = buildSignedLicense(buildClaims(), keys.privateKey);
    const layout = await createTempLicenseLayout({ publicKeyPem: keys.publicKey });
    await fs.rm(layout.appRoot, { recursive: true, force: true });

    const loader = new LicenseLoader({
      appRoot: "/nonexistent-root",
      searchPaths: ["config/license.lic.json"],
      envContent: JSON.stringify(container),
    });
    const loaded = await loader.load();
    expect(loaded.source).toBe("env:LICENSE_CONTENT");
    expect(loaded.container.kid).toBe(DEFAULT_KID);
  });
});

describe("SignatureVerifier", () => {
  test("rejects missing signature", () => {
    const verifier = new SignatureVerifier({
      allowedAlgorithms: ["RS256"],
      allowedHashes: ["SHA-256"],
    });
    expect(() =>
      verifier.verify(
        { alg: "RS256", hash: "SHA-256", payload: "YQ", signature: "" },
        {},
      ),
    ).toThrow(InvalidLicenseException);
  });
});
