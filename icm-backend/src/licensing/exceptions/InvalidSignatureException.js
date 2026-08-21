import { LicenseException } from "./LicenseException.js";

export class InvalidSignatureException extends LicenseException {
  constructor(internalReason = "License signature verification failed") {
    super(internalReason, "LICENSE_SIGNATURE_INVALID");
    this.name = "InvalidSignatureException";
  }
}
