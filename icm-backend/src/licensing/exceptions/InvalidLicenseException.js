import { LicenseException } from "./LicenseException.js";

export class InvalidLicenseException extends LicenseException {
  constructor(internalReason = "License is invalid or malformed") {
    super(internalReason, "LICENSE_MALFORMED");
    this.name = "InvalidLicenseException";
  }
}
