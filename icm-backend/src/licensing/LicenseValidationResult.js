/**
 * Immutable result of a successful license validation.
 * Extension point for future feature/edition/seat enforcement.
 */
export class LicenseValidationResult {
  /**
   * @param {object} params
   * @param {object} params.claims Decoded license payload claims
   * @param {string} params.source Path or descriptor of license source
   * @param {string} params.kid Key id used for verification
   */
  constructor({ claims, source, kid }) {
    this.valid = true;
    this.claims = Object.freeze({ ...claims });
    this.source = source;
    this.kid = kid;
    Object.freeze(this);
  }

  get licenseId() {
    return this.claims.licenseId;
  }

  get customer() {
    const c = this.claims.customer;
    if (c && typeof c === "object") {
      return c.name || c.code || "";
    }
    return c;
  }

  get productCode() {
    const p = this.claims.product;
    if (p && typeof p === "object") {
      return p.code || this.claims.aud;
    }
    return p || this.claims.aud;
  }

  get edition() {
    return this.claims.edition;
  }

  get expiresAt() {
    return this.claims.expiresAt;
  }

  get issuer() {
    return this.claims.iss;
  }

  get audience() {
    return this.claims.aud;
  }

  /** Safe summary for logging — never includes payload/signature/crypto material. */
  toLogSummary() {
    return {
      licenseId: this.licenseId,
      customer: this.customer,
      edition: this.edition,
      expiresAt: this.expiresAt,
      issuer: this.issuer,
      audience: this.audience,
      kid: this.kid,
      source: this.source,
    };
  }
}
