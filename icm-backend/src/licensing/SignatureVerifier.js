import crypto from "crypto";
import { isBase64Url, base64UrlDecode } from "./base64Url.js";
import { InvalidSignatureException } from "./exceptions/InvalidSignatureException.js";
import { InvalidLicenseException } from "./exceptions/InvalidLicenseException.js";
import { UnsupportedAlgorithmException } from "./exceptions/UnsupportedAlgorithmException.js";
import { UnsupportedHashException } from "./exceptions/UnsupportedHashException.js";

/**
 * Verifies RS256 signatures per LMS contract:
 *   openssl_verify(payload_base64url_string, signature, publicKey, SHA256)
 */
export class SignatureVerifier {
  /**
   * @param {object} config
   * @param {string[]} config.allowedAlgorithms
   * @param {string[]} config.allowedHashes
   */
  constructor(config) {
    this.allowedAlgorithms = (config.allowedAlgorithms || []).map((a) => a.trim());
    this.allowedHashes = (config.allowedHashes || []).map((h) => h.trim());
  }

  /**
   * @param {object} container License container
   * @param {import('crypto').KeyObject} publicKey
   */
  verify(container, publicKey) {
    const alg = container.alg;
    const hash = container.hash;

    if (!alg || !this.allowedAlgorithms.includes(alg)) {
      throw new UnsupportedAlgorithmException(
        `Unsupported or missing algorithm "${alg}". Allowed: ${this.allowedAlgorithms.join(", ")}`,
      );
    }

    if (!hash || !this.allowedHashes.includes(hash)) {
      throw new UnsupportedHashException(
        `Unsupported or missing hash "${hash}". Allowed: ${this.allowedHashes.join(", ")}`,
      );
    }

    if (alg === "RS256" && hash !== "SHA-256") {
      throw new UnsupportedHashException(
        `Algorithm RS256 requires SHA-256 hash, got "${hash}"`,
      );
    }

    const payloadB64 = container.payload;
    const signatureB64 = container.signature;

    if (payloadB64 === undefined || payloadB64 === null || payloadB64 === "") {
      throw new InvalidLicenseException("License payload is missing");
    }

    if (signatureB64 === undefined || signatureB64 === null || signatureB64 === "") {
      throw new InvalidLicenseException("License signature is missing");
    }

    if (typeof payloadB64 !== "string" || typeof signatureB64 !== "string") {
      throw new InvalidLicenseException("License payload and signature must be Base64URL strings");
    }

    if (!isBase64Url(payloadB64)) {
      throw new InvalidLicenseException("License payload is not valid Base64URL");
    }

    if (!isBase64Url(signatureB64)) {
      throw new InvalidLicenseException("License signature is not valid Base64URL");
    }

    let signature;
    try {
      signature = base64UrlDecode(signatureB64);
      if (signature.length === 0) {
        throw new Error("empty");
      }
    } catch {
      throw new InvalidLicenseException("License signature is not valid Base64URL");
    }

    // LMS signs the payload string itself (UTF-8 of Base64URL text)
    const data = Buffer.from(payloadB64, "utf8");

    let ok;
    try {
      ok = crypto.verify("RSA-SHA256", data, publicKey, signature);
    } catch (err) {
      throw new InvalidSignatureException(`Signature verification error: ${err.message}`);
    }

    if (!ok) {
      throw new InvalidSignatureException("RSA-SHA256 signature verification failed");
    }
  }
}
