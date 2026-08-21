import mongoose from "mongoose";
import { hrmsApplicationSubSchema } from "./hrmsApplicationSubSchema.js";

// Define the structure for a single mapping rule so we can reuse it
const mappingRuleSchema = new mongoose.Schema(
  {
    csvColumn: { type: String, required: true },
    standardField: { type: String, required: true },
    dataType: { type: String, default: "String" },
    isSensitive: { type: Boolean, default: false },
    isPrimaryKey: { type: Boolean, default: false },
    /** UI label (Application schema tab); optional */
    displayName: { type: String, default: "" },
    /** Optional max length metadata for validation / UI */
    maxLength: { type: Number, required: false },
  },
  { _id: false },
); // _id: false prevents Mongoose from cluttering the DB with an ID for every single mapped row

const applicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    type: {
      type: String,
      enum: ["web", "database", "directory", "cloud", "erp", "custom"],
      default: "web",
    },
    owner: { type: String },
    ownerEmail: { type: String },
    status: {
      type: String,
      enum: ["active", "inactive", "decommissioned", "pending"],
      default: "active",
    },

    // Risk & Compliance
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    riskJustification: { type: String },
    complianceFrameworks: [
      {
        type: String,
        enum: ["SOX", "GDPR", "HIPAA", "PCI-DSS", "ISO27001", "NIST"],
      },
    ],
    dataClassification: {
      type: String,
      enum: ["public", "internal", "confidential", "restricted"],
      default: "internal",
    },

    // Connection & Integration
    integrationType: {
      type: String,
      enum: ["manual", "auto", "api", "connector"],
      default: "manual",
    },
    connectorType: { type: String },
    connectionConfig: { type: mongoose.Schema.Types.Mixed },
    autoUploadSchedule: {
      type: String,
      enum: ["daily", "weekly", "monthly", "none"],
      default: "none",
    },
    autoUploadTime: { type: String },

    // Schema & Mapping (NEW: Separated for Users and Entitlements)
    userMappings: [mappingRuleSchema],
    entitlementMappings: [mappingRuleSchema],
    identityMappings: [mappingRuleSchema], // <-- ADD THIS LINE

    /**
     * Separate CSV → field mapping for the guided "Map & import" flow.
     * Does not replace a richer userMappings with the reduced import list; mapped import
     * may ensure userMappings from the complete detected CSV header schema when empty.
     */
    /**
     * UI-only layout for Current accounts (column order + visibility). Does not affect
     * userMappings, connector sync, reconciliation, or ingested account data.
     */
    accountsTablePreferences: {
      type: new mongoose.Schema(
        {
          columnOrder: { type: [String], default: [] },
          visibleColumns: { type: [String], default: [] },
          updatedAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },

    /** Per-application security scan thresholds (Security Center + AD sync scans). */
    securityScanSettings: {
      type: new mongoose.Schema(
        {
          inactiveUsersDays: {
            type: Number,
            default: 90,
            min: 1,
            max: 3650,
          },
          inactiveComputersDays: {
            type: Number,
            default: 90,
            min: 1,
            max: 3650,
          },
          unsupportedOsTokens: {
            type: [String],
            default: undefined,
          },
          workstationOuPatterns: {
            type: [String],
            default: undefined,
          },
        },
        { _id: false },
      ),
      default: undefined,
    },

    csvImportMapping: {
      type: new mongoose.Schema(
        {
          mappings: { type: [mappingRuleSchema], default: [] },
          displayNameMode: {
            type: String,
            enum: ["direct", "first_last"],
            default: "direct",
          },
          displayNameFirstColumn: { type: String, default: "" },
          displayNameLastColumn: { type: String, default: "" },
          /** When displayNameMode is `direct`, optional first/last columns used if the display column is empty. */
          displayNameFallbackFirstColumn: { type: String, default: "" },
          displayNameFallbackLastColumn: { type: String, default: "" },
          /** Technical field that receives the entitlements list column from Map & import (e.g. member_of_entitlements). */
          entitlementsStandardField: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: undefined,
    },

    // Stats
    totalUsers: { type: Number, default: 0 },
    entitlementCount: { type: Number, default: 0 }, // Changed to match the controller & frontend
    totalAccounts: { type: Number, default: 0 },
    lastAggregation: { type: Date },
    lastUpload: { type: Date },

    reconciliationConfig: {
      type: new mongoose.Schema(
        {
          removedUserHandling: {
            type: String,
            enum: ["REMOVED_USER", "MARK_INACTIVE"],
            default: "REMOVED_USER",
          },
          inactiveStatusValues: {
            type: [String],
            default: ["inactive", "disabled", "terminated"],
          },
          compareFieldsMode: {
            type: String,
            enum: ["userMappings", "all_present"],
            default: "userMappings",
          },
        },
        { _id: false },
      ),
      default: undefined,
    },

    /** True when this application is the directory/AD target linked from tenant HRMS integration (HRMS → IGA → AD). */
    hrmsDirectoryTarget: { type: Boolean, default: false },

    /**
     * Optional HR connector payload (OrangeHRM OAuth, delimited CSV, etc.).
     * Created like any application; identity profiles reference this app as the authoritative source.
     */
    hrms: { type: hrmsApplicationSubSchema, default: undefined },

    /** Last manual correlation run (identities ↔ app user store) for UI persistence. */
    lastManualCorrelationAt: { type: Date },
    lastManualCorrelation: {
      type: new mongoose.Schema(
        {
          identityAttribute: { type: String, default: "" },
          accountAttribute: { type: String, default: "" },
          /** Ordered fallback rules from the last run (priority ascending). Mirrors identityAttribute/accountAttribute for rule 1. */
          rules: {
            type: [
              new mongoose.Schema(
                {
                  identityAttribute: { type: String, required: true },
                  accountAttribute: { type: String, required: true },
                  priority: { type: Number, required: true },
                },
                { _id: false },
              ),
            ],
            default: undefined,
          },
          totalProcessed: { type: Number, default: 0 },
          newlyLinked: { type: Number, default: 0 },
          orphansDetected: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      default: undefined,
    },

    // Certification Configuration - Default Reviewers
    defaultCertificationReviewers: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        email: { type: String },
        name: { type: String },
        reviewerType: {
          type: String,
          enum: ["manager", "reviewer", "delegate"],
          default: "reviewer",
        },
      },
    ],
    autoAssignAppManagersToCertification: { type: Boolean, default: true },

    // Metadata
    /** Source system that discovered or supplied this application record (e.g. ActiveDirectory). */
    source: { type: String, default: "" },
    /** Onboarding mode used when the app record was created (e.g. Auto). */
    onboardingType: { type: String, default: "" },
    /** Optional parent/source application that produced this app during onboarding flows. */
    sourceApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: false,
    },
    /** Master / trusted people or identity feed (HRMS, directory, etc.) — for JML, aggregation priority, reporting. */
    authoritativeSource: { type: Boolean, default: false },
    tags: [String],
    /** Ref to tenant ApplicationIcon library entry. */
    iconId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ApplicationIcon",
      required: false,
      default: null,
    },
    /** Resolved image URL cache, e.g. /api/application-icons/:id/image */
    icon: { type: String },
    color: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "applications" },
);

applicationSchema.index({ name: 1 });
applicationSchema.index({ status: 1 });
applicationSchema.index({ tenantId: 1, authoritativeSource: 1 });
applicationSchema.index({ tenantId: 1, "hrms.connector": 1 }, { sparse: true });

export default mongoose.model("Application", applicationSchema);
