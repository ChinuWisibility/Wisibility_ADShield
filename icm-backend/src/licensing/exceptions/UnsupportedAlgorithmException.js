import { LicenseException } from "./LicenseException.js";

export class UnsupportedAlgorithmException extends LicenseException {
  constructor(internalReason = "Unsupported license signing algorithm") {
    super(internalReason, "LICENSE_ALG_UNSUPPORTED");
    this.name = "UnsupportedAlgorithmException";
  }
}
