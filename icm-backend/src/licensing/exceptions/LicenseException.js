/**
 * Base exception for all license validation failures.
 * External callers should only surface the safe public message.
 */
export class LicenseException extends Error {
  /**
   * @param {string} internalReason Precise internal reason (logged, never sent to clients)
   * @param {string} [code] Machine-readable failure code
   */
  constructor(internalReason, code = "LICENSE_INVALID") {
    super("License validation failed.");
    this.name = "LicenseException";
    this.code = code;
    this.internalReason = internalReason;
    this.isOperational = true;
  }
}
