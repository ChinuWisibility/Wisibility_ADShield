import { LicenseException } from "./LicenseException.js";

export class PublicKeyNotFoundException extends LicenseException {
  constructor(internalReason = "Public key not found for license kid") {
    super(internalReason, "LICENSE_KEY_NOT_FOUND");
    this.name = "PublicKeyNotFoundException";
  }
}
