import { LicenseException } from "./LicenseException.js";

export class MissingLicenseException extends LicenseException {
  constructor(internalReason = "License file not found") {
    super(internalReason, "LICENSE_MISSING");
    this.name = "MissingLicenseException";
  }
}
