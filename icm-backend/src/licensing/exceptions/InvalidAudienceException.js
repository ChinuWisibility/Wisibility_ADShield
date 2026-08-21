import { LicenseException } from "./LicenseException.js";

export class InvalidAudienceException extends LicenseException {
  constructor(internalReason = "License audience mismatch") {
    super(internalReason, "LICENSE_AUDIENCE_INVALID");
    this.name = "InvalidAudienceException";
  }
}
