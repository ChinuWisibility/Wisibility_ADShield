/**
 * In-memory store for the validated license context.
 * Extension point for revocation lists, seat tracking, and usage telemetry.
 */
export class LicenseRepository {
  constructor() {
    /** @type {import('./LicenseValidationResult.js').LicenseValidationResult | null} */
    this.#current = null;
  }

  #current;

  /**
   * @param {import('./LicenseValidationResult.js').LicenseValidationResult} result
   */
  save(result) {
    this.#current = result;
  }

  /**
   * @returns {import('./LicenseValidationResult.js').LicenseValidationResult | null}
   */
  get() {
    return this.#current;
  }

  clear() {
    this.#current = null;
  }

  isLicensed() {
    return this.#current !== null && this.#current.valid === true;
  }
}
