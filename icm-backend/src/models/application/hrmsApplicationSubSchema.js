import mongoose from "mongoose";

/**
 * HR / authoritative people data lives on an Application (App Registry), same as any connector.
 * Identity profiles pick one application as source; other applications remain targets.
 */
export const hrmsApplicationSubSchema = new mongoose.Schema(
  {
    connector: {
      type: String,
      enum: ["orangehrm", "delimited_file"],
      default: "orangehrm",
    },
    provider: { type: String, enum: ["orangehrm", "generic_oauth"], default: "orangehrm" },
    displayName: { type: String, default: "OrangeHRM" },
    baseUrl: { type: String, trim: true, default: "" },
    clientId: { type: String, trim: true, default: "" },
    clientSecret: { type: String, default: "" },
    authorizePath: { type: String, default: "/web/index.php/oauth2/authorize" },
    tokenPath: { type: String, default: "/web/index.php/oauth2/token" },
    employeesApiPath: { type: String, trim: true, default: "" },
    accessToken: { type: String, default: "" },
    refreshToken: { type: String, default: "" },
    tokenExpiresAt: { type: Date },
    connectionStatus: {
      type: String,
      enum: ["disconnected", "connected", "error"],
      default: "disconnected",
    },
    lastError: { type: String },
    lastAuthorizedAt: { type: Date },
    directoryTargetApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      default: null,
    },
    isActive: { type: Boolean, default: true },
    delimitedCsvHeaders: { type: [String], default: [] },
    delimitedPreviewRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    delimitedImportRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    delimitedRowCount: { type: Number },
    delimitedLastUploadAt: { type: Date },
    delimitedLastFileName: { type: String, trim: true, default: "" },
    authoritativeIdentitySource: { type: Boolean, default: false },
    lastIdentitySyncAt: { type: Date },
    lastIdentitySyncCount: { type: Number },
    lastIdentitySyncError: { type: String },
    /** Set once when row was migrated from legacy hrms_integrations collection */
    migratedFromHrmsId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);
