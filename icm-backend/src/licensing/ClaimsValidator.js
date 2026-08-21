import { InvalidLicenseException } from "./exceptions/InvalidLicenseException.js";
import { InvalidSchemaException } from "./exceptions/InvalidSchemaException.js";
import { InvalidIssuerException } from "./exceptions/InvalidIssuerException.js";
import { InvalidAudienceException } from "./exceptions/InvalidAudienceException.js";
import { ExpiredLicenseException } from "./exceptions/ExpiredLicenseException.js";

const MANDATORY_CLAIMS = [
  "schema",
  "id",
  "licenseId",
  "iss",
  "aud",
  "type",
  "customer",
  "product",
  "edition",
  "features",
  "issuedAt",
  "expiresAt",
];

/**
 * Validates decoded license claims per LMS schema 1.0.
 * Feature/edition enforcement is intentionally not performed — reserved for future work.
 */
export class ClaimsValidator {
  /**
   * @param {object} config
   * @param {string|number} config.expectedSchemaVersion  e.g. "1.0"
   * @param {string} config.issuer
   * @param {string} config.audience  Product code (aud)
   * @param {string} [config.expectedProduct] Product code; defaults to audience
   * @param {string[]} [config.allowedTypes]
   * @param {() => Date} [config.now]
   */
  constructor(config) {
    this.expectedSchemaVersion = String(config.expectedSchemaVersion);
    this.issuer = config.issuer;
    this.audience = config.audience;
    this.expectedProduct = config.expectedProduct || config.audience || null;
    this.allowedTypes = config.allowedTypes || [
      "Commercial",
      "Trial",
      "Evaluation",
      "Educational",
      "Internal",
      "development", // local smoke licenses
    ];
    this.now = config.now || (() => new Date());
  }

  /**
   * @param {object} claims
   */
  validate(claims) {
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
      throw new InvalidLicenseException("Decoded license payload must be a JSON object");
    }

    for (const claim of MANDATORY_CLAIMS) {
      if (!this.#claimPresent(claims[claim])) {
        throw new InvalidLicenseException(`Missing mandatory claim: ${claim}`);
      }
    }

    if (String(claims.schema) !== this.expectedSchemaVersion) {
      throw new InvalidSchemaException(
        `License schema "${claims.schema}" does not match expected "${this.expectedSchemaVersion}"`,
      );
    }

    if (claims.iss !== this.issuer) {
      throw new InvalidIssuerException(
        `License issuer "${claims.iss}" does not match expected "${this.issuer}"`,
      );
    }

    if (!this.#audienceMatches(claims.aud, this.audience)) {
      throw new InvalidAudienceException(
        `License audience "${this.#formatAud(claims.aud)}" does not match expected "${this.audience}"`,
      );
    }

    const productCode = this.#productCode(claims);
    if (!productCode) {
      throw new InvalidLicenseException("Missing product code");
    }

    if (this.expectedProduct && productCode !== this.expectedProduct) {
      throw new InvalidLicenseException(
        `License product "${productCode}" does not match expected "${this.expectedProduct}"`,
      );
    }

    // LMS rule: aud must match product.code
    if (typeof claims.aud === "string" && claims.aud !== productCode) {
      throw new InvalidLicenseException(
        `Audience "${claims.aud}" does not match product code "${productCode}"`,
      );
    }

    if (!this.#customerPresent(claims.customer)) {
      throw new InvalidLicenseException("License customer claim is incomplete");
    }

    if (!this.allowedTypes.includes(claims.type)) {
      throw new InvalidLicenseException(`Unsupported license type: ${claims.type}`);
    }

    const issuedAt = this.#parseDate(claims.issuedAt, "issuedAt");
    const expiresAt = this.#parseDate(claims.expiresAt, "expiresAt");

    if (expiresAt.getTime() <= issuedAt.getTime()) {
      throw new InvalidLicenseException("License expiresAt must be after issuedAt");
    }

    const now = this.now();
    if (expiresAt.getTime() <= now.getTime()) {
      throw new ExpiredLicenseException(
        `License expired at ${expiresAt.toISOString()} (now ${now.toISOString()})`,
      );
    }

    if (!Array.isArray(claims.features)) {
      throw new InvalidLicenseException("License claim features must be an array");
    }
  }

  #claimPresent(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value === "") return false;
    return true;
  }

  #customerPresent(customer) {
    if (typeof customer === "string") return customer.length > 0;
    if (customer && typeof customer === "object") {
      return Boolean(customer.code || customer.name);
    }
    return false;
  }

  #productCode(claims) {
    if (claims.product && typeof claims.product === "object" && claims.product.code) {
      return String(claims.product.code);
    }
    if (typeof claims.product === "string") {
      return claims.product;
    }
    if (typeof claims.aud === "string") {
      return claims.aud;
    }
    return null;
  }

  #audienceMatches(aud, expected) {
    if (typeof aud === "string") {
      return aud === expected;
    }
    if (Array.isArray(aud)) {
      return aud.includes(expected);
    }
    return false;
  }

  #formatAud(aud) {
    return Array.isArray(aud) ? aud.join(",") : String(aud);
  }

  #parseDate(value, claimName) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new InvalidLicenseException(`License claim ${claimName} is not a valid date`);
    }
    return date;
  }
}

export { MANDATORY_CLAIMS };
