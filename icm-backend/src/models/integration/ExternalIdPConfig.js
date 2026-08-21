import mongoose from "mongoose";

const externalIdPConfigSchema = new mongoose.Schema(
  {
    providerName: {
      type: String,
      required: true,
      enum: ["AzureAD", "Okta", "PingIdentity", "ADFS"],
    },
    protocol: { type: String, enum: ["SAML2", "OIDC"] },
    entityId: { type: String },
    ssoUrl: { type: String },
    x509Certificate: { type: String },
    clientId: { type: String },
    clientSecretEncrypted: { type: String },
    isEnabled: { type: Boolean, default: false, index: true },
    attributeMapping: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "external_idp_configs" },
);

externalIdPConfigSchema.index({ providerName: 1 });

export default mongoose.model("ExternalIdPConfig", externalIdPConfigSchema);
