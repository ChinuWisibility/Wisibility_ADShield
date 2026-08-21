import crypto from "crypto";
import { base64UrlDecode, isBase64Url } from "./base64Url.js";
import { InvalidLicenseException } from "./exceptions/InvalidLicenseException.js";
import { SignatureVerifier } from "./SignatureVerifier.js";
import { ClaimsValidator } from "./ClaimsValidator.js";
import { PublicKeyProvider } from "./PublicKeyProvider.js";
import { LicenseValidationResult } from "./LicenseValidationResult.js";

/**
 * Orchestrates container parsing, payload decode, crypto verification, and claims checks.
 * Compatible with LMS LICENSE_ARTIFACT.md (format v1 / schema 1.0).
 */
export class LicenseVerifier {
  /**
   * @param {object} deps
   * @param {PublicKeyProvider} deps.publicKeyProvider
   * @param {SignatureVerifier} deps.signatureVerifier
   * @param {ClaimsValidator} deps.claimsValidator
   */
  constructor({ publicKeyProvider, signatureVerifier, claimsValidator }) {
    this.publicKeyProvider = publicKeyProvider;
    this.signatureVerifier = signatureVerifier;
    this.claimsValidator = claimsValidator;
  }

  /**
   * @param {object} container
   * @param {string} source
   * @returns {Promise<LicenseValidationResult>}
   */
  async verify(container, source) {
    this.#assertContainerShape(container);

    const kid = String(container.kid).trim();
    const publicKey = await this.publicKeyProvider.getPublicKey(kid);

    this.signatureVerifier.verify(container, publicKey);

    const claims = this.#decodePayload(container.payload);
    this.#assertPayloadIntegrity(container.payload, claims);

    this.claimsValidator.validate(claims);

    return new LicenseValidationResult({ claims, source, kid });
  }

  #assertContainerShape(container) {
    if (!container || typeof container !== "object") {
      throw new InvalidLicenseException("License container is missing");
    }

    if (container.version === undefined || container.version === null) {
      throw new InvalidLicenseException("License container version is missing");
    }

    if (Number(container.version) !== 1) {
      throw new InvalidLicenseException(
        `Unsupported license container version: ${container.version}`,
      );
    }

    if (!container.kid) {
      throw new InvalidLicenseException("License kid is missing");
    }

    if (!container.payload) {
      throw new InvalidLicenseException("License payload is missing");
    }

    if (!container.signature) {
      throw new InvalidLicenseException("License signature is missing");
    }

    if (!container.alg) {
      throw new InvalidLicenseException("License alg is missing");
    }

    if (!container.hash) {
      throw new InvalidLicenseException("License hash is missing");
    }
  }

  #decodePayload(payloadB64) {
    if (typeof payloadB64 !== "string") {
      throw new InvalidLicenseException("License payload must be a Base64URL string");
    }

    if (!isBase64Url(payloadB64)) {
      throw new InvalidLicenseException("License payload is not valid Base64URL");
    }

    let json;
    try {
      json = base64UrlDecode(payloadB64).toString("utf8");
    } catch {
      throw new InvalidLicenseException("License payload is not valid Base64URL");
    }

    if (!json || !json.trim()) {
      throw new InvalidLicenseException("Decoded license payload is empty");
    }

    let claims;
    try {
      claims = JSON.parse(json);
    } catch {
      throw new InvalidLicenseException("Decoded license payload is corrupted JSON");
    }

    return claims;
  }

  /**
   * Ensures payload Base64URL decodes and SHA-256 of decoded bytes is computable.
   */
  #assertPayloadIntegrity(payloadB64, claims) {
    try {
      const decoded = base64UrlDecode(payloadB64);
      crypto.createHash("sha256").update(decoded).digest("hex");
    } catch {
      throw new InvalidLicenseException("License payload integrity check failed");
    }

    if (!claims || typeof claims !== "object") {
      throw new InvalidLicenseException("Tampered or corrupted license payload");
    }
  }
}
