import mongoose from "mongoose";

const attributeMappingSchema = new mongoose.Schema(
  {
    targetKey: { type: String, required: true, trim: true },
    targetLabel: { type: String, default: "" },
    /** App Registry application that supplies this attribute (typically the profile source app). */
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: false,
    },
    /** @deprecated Use applicationId — legacy ref to hrms_integrations */
    hrmsSourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HrmsIntegration",
      required: false,
    },
    /** CSV column name (delimited) or logical field name for API sources */
    sourceAttribute: { type: String, default: "" },
    transform: {
      type: String,
      enum: ["none", "toLower", "toUpper", "trim", "concatFirstLast", "defaultIfEmpty"],
      default: "none",
    },
    /** Used when transform is defaultIfEmpty */
    transformDefault: { type: String, default: "" },
    /** Optional Transform Studio document (tenant-scoped); when set, built-in `transform` is ignored at runtime. */
    customTransformId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transform",
      default: null,
    },
  },
  { _id: true },
);

const identityProfileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String },
    /** App Registry application that is the authoritative HR / people source for this profile. */
    sourceApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      default: null,
    },
    /** @deprecated Use sourceApplicationId — legacy hrms_integrations ref */
    hrmsSourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HrmsIntegration",
      default: null,
    },
    /**
     * How identity profile mappings read from the delimited source:
     * - delimited_csv: sourceAttribute = raw CSV column header (after upload).
     * - application_account_schema: sourceAttribute = Application userMappings.standardField (Schema Management blueprint).
     */
    mappingSourceMode: {
      type: String,
      enum: ["delimited_csv", "application_account_schema"],
      default: "delimited_csv",
    },
    /**
     * Which mapped identity attribute is the correlation / unique key for upserts (Employee ID vs email vs uid).
     */
    correlationTargetKey: {
      type: String,
      enum: ["email", "employeeId", "uid"],
      default: "email",
    },
    /** Optional secondary correlation (e.g. email when primary is employeeId). */
    correlationFallbackKey: {
      type: String,
      enum: ["email", "employeeId", "uid"],
    },
    /** How to link managerId after import: manager email or manager employee id field. */
    managerLinkBy: {
      type: String,
      enum: ["email", "employeeId"],
      default: "email",
    },
    /**
     * Manager correlation: manager field (targetKey) → lookup by reference attribute on other identities.
     * Configured in profile Settings; both strings required before saving mappings.
     */
    managerCorrelation: {
      managerAttribute: { type: String, default: "", trim: true },
      referenceAttribute: { type: String, default: "", trim: true },
    },
    /**
     * CSV / status value → lifecycle state (e.g. { "LOA": "LEAVER", "ACTIVE": "ACTIVE" }).
     * Empty = use built-in heuristics.
     */
    lifecycleRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    /**
     * SailPoint-style attribute precedence when multiple applications contribute (advanced).
     * Lower priority number wins.
     */
    attributeAuthority: {
      type: [
        {
          targetKey: { type: String, trim: true },
          sourceApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
          priority: { type: Number, default: 100 },
        },
      ],
      default: [],
    },
    /** HRMS → identity attribute mappings (Mappings tab). */
    attributeMappings: { type: [attributeMappingSchema], default: [] },
    attributes: {
      title: [String],
      department: [String],
      memberOf: [String],
      applications: [String],
      status: [String],
    },
    expectedEntitlements: [String],
    expectedApplications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Application' }],
    riskTier: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    certificationFrequencyDays: { type: Number },
    isActive: { type: Boolean, default: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    tags: [String],
    /**
     * Draft persistence: stores mapping rows before final Save Mappings validation is complete.
     * Cleared automatically when putIdentityProfileMappings succeeds.
     */
    mappingDraft: {
      isDraft: { type: Boolean, default: false },
      draftSavedAt: { type: Date, default: null },
      draftVersion: { type: Number, default: 0 },
      /** Raw attribute mapping rows — same shape as attributeMappingSchema but stored as Mixed for flexibility. */
      mappingDraftData: { type: mongoose.Schema.Types.Mixed, default: [] },
    },
  },
  { timestamps: true, collection: "identity_profiles" },
);

export default mongoose.model("IdentityProfile", identityProfileSchema);
