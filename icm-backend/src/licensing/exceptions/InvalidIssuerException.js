import { LicenseException } from "./LicenseException.js";

export class InvalidIssuerException extends LicenseException {
  constructor(internalReason = "License issuer mismatch") {
    super(internalReason, "LICENSE_ISSUER_INVALID");
    this.name = "InvalidIssuerException";
  }
}
