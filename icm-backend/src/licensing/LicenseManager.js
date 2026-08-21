import { LicenseLoader } from "./LicenseLoader.js";
import { PublicKeyProvider } from "./PublicKeyProvider.js";
import { SignatureVerifier } from "./SignatureVerifier.js";
import { ClaimsValidator } from "./ClaimsValidator.js";
import { LicenseVerifier } from "./LicenseVerifier.js";
import { LicenseRepository } from "./LicenseRepository.js";
import { LicenseException } from "./exceptions/LicenseException.js";

/**
 * Sole public entry point for Identity Sphere licensing.
 * No other module should interact with loaders/verifiers directly.
 *
 * Future extension points (not implemented):
 * - Feature enforcement
 * - Edition enforcement
 * - Concurrent seat validation
 * - Offline / online activation
 * - License renewal & revocation
 * - Grace periods
 * - License usage telemetry
 */
export class LicenseManager {
  /**
   * @param {object} [config] Licensing config from env.license
   * @param {object} [deps] Optional overrides for testing
   */
  constructor(config, deps = {}) {
    if (!config) {
      throw new Error("LicenseManager requires configuration");
    }

    this.config = config;
    this.repository = deps.repository || new LicenseRepository();

    this.loader =
      deps.loader ||
      new LicenseLoader({
        appRoot: config.appRoot,
        searchPaths: config.searchPaths,
        envFilePath: config.envFilePath,
        envContent: config.envContent,
      });

    this.publicKeyProvider =
      deps.publicKeyProvider ||
      new PublicKeyProvider({
        keysDir: config.keysDir,
      });

    this.signatureVerifier =
      deps.signatureVerifier ||
      new SignatureVerifier({
        allowedAlgorithms: config.allowedAlgorithms,
        allowedHashes: config.allowedHashes,
      });

    this.claimsValidator =
      deps.claimsValidator ||
      new ClaimsValidator({
        expectedSchemaVersion: config.schemaVersion,
        issuer: config.issuer,
        audience: config.audience,
        expectedProduct: config.expectedProduct,
        allowedTypes: config.allowedTypes,
        now: config.now,
      });

    this.verifier =
      deps.verifier ||
      new LicenseVerifier({
        publicKeyProvider: this.publicKeyProvider,
        signatureVerifier: this.signatureVerifier,
        claimsValidator: this.claimsValidator,
      });
  }

  /**
   * Validates the product license. On failure throws LicenseException (or subclass).
   * On success stores result in the repository and returns LicenseValidationResult.
   *
   * @returns {Promise<import('./LicenseValidationResult.js').LicenseValidationResult>}
   */
  async validate() {
    console.log("[License] Initializing license validation");

    try {
      const { container, source } = await this.loader.load();
      console.log(`[License] License loaded from ${this.#safeSource(source)}`);

      const result = await this.verifier.verify(container, source);
      this.repository.save(result);

      const summary = result.toLogSummary();
      console.log("[License] Validation success");
      console.log(`[License] License ID: ${summary.licenseId}`);
      console.log(`[License] Customer: ${summary.customer}`);
      console.log(`[License] Edition: ${summary.edition}`);
      console.log(`[License] Expiry: ${summary.expiresAt}`);
      console.log(`[License] Issuer: ${summary.issuer}`);
      console.log(`[License] Audience: ${summary.audience}`);

      return result;
    } catch (err) {
      const reason =
        err instanceof LicenseException
          ? err.internalReason
          : err?.message || "Unknown license validation error";

      console.error("[License] Validation failure");
      console.error(`[License] Reason: ${reason}`);
      console.error("[License] Startup blocked");

      if (err instanceof LicenseException) {
        throw err;
      }

      throw new LicenseException(reason);
    }
  }

  /**
   * @returns {import('./LicenseValidationResult.js').LicenseValidationResult | null}
   */
  getValidatedLicense() {
    return this.repository.get();
  }

  isLicensed() {
    return this.repository.isLicensed();
  }

  /**
   * Hot-reload license from disk (or provided container) without process restart.
   * @param {{ raw?: string, filePath?: string }} [opts]
   * @returns {Promise<import('./LicenseValidationResult.js').LicenseValidationResult>}
   */
  async reload(opts = {}) {
    console.log("[License] Hot reload requested");

    let container;
    let source;

    if (opts.raw) {
      const parsed = JSON.parse(String(opts.raw));
      container = parsed;
      source = opts.filePath || "upload";
    } else if (opts.filePath) {
      const fs = await import("fs/promises");
      const raw = await fs.readFile(opts.filePath, "utf8");
      container = JSON.parse(raw);
      source = opts.filePath;
    } else {
      const loaded = await this.loader.load();
      container = loaded.container;
      source = loaded.source;
    }

    const result = await this.verifier.verify(container, source);
    this.repository.save(result);
    console.log("[License] Hot reload success");
    return result;
  }

  /**
   * Clear in-memory license (e.g. after failed upload before replace).
   */
  clear() {
    this.repository.clear();
  }

  /**
   * Future: feature enforcement. Today the product is sold as one complete unit.
   * @param {string} _featureId
   * @returns {boolean}
   */
  isFeatureEnabled(_featureId) {
    return this.isLicensed();
  }

  #safeSource(source) {
    if (!source) return "unknown";
    if (source.startsWith("env:")) return source;
    // Log basename only to avoid leaking full deployment paths unnecessarily
    const parts = String(source).split(/[/\\]/);
    return parts[parts.length - 1] || source;
  }
}

/**
 * Creates a LicenseManager from application env.license config.
 * @param {object} licenseConfig
 * @returns {LicenseManager}
 */
export function createLicenseManager(licenseConfig) {
  return new LicenseManager(licenseConfig);
}
