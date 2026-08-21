import { LicenseException } from "./LicenseException.js";

export class InvalidSchemaException extends LicenseException {
  constructor(internalReason = "License schema version unsupported") {
    super(internalReason, "LICENSE_SCHEMA_INVALID");
    this.name = "InvalidSchemaException";
  }
}
