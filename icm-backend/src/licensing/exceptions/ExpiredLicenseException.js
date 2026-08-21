import { LicenseException } from "./LicenseException.js";

export class ExpiredLicenseException extends LicenseException {
  constructor(internalReason = "License has expired") {
    super(internalReason, "LICENSE_EXPIRED");
    this.name = "ExpiredLicenseException";
  }
}
