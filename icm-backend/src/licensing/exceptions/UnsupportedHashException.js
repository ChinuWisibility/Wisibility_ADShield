import { LicenseException } from "./LicenseException.js";

export class UnsupportedHashException extends LicenseException {
  constructor(internalReason = "Unsupported license hash algorithm") {
    super(internalReason, "LICENSE_HASH_UNSUPPORTED");
    this.name = "UnsupportedHashException";
  }
}
