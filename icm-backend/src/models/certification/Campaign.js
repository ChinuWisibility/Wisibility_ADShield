import mongoose from "mongoose";

const reviewerAssignmentSchema = new mongoose.Schema(
  {
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewerType: {
      type: String,
      enum: ["MANAGER", "EXTERNAL", "IDENTITY_ADMIN"],
    },
    email: { type: String },
    name: { type: String },
    // who added this reviewer to the campaign
    assignedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: { type: String },
      email: { type: String },
    },
    assignedAt: { type: Date, default: Date.now },
    // live per-reviewer decision counters (updated on each decision)
    progress: {
      total: { type: Number, default: 0 },
      approved: { type: Number, default: 0 },
      revoked: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      completion: { type: Number, default: 0 }, // percentage 0-100
      lastActionAt: { type: Date },
    },
  },
  { _id: false },
);

const campaignSchema = new mongoose.Schema(
  {
    // Core
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    certificationProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CertificationProfile",
      index: true,
    },
    /** PROFILE-scope population source (Identity Profile). */
    identityProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IdentityProfile",
      index: true,
    },
    applicationName: { type: String },
    name: { type: String, required: true, maxlength: 200 },
    description: { type: String },

    // Classification
    certificationScope: {
      type: String,
      enum: ["APPLICATION", "PROFILE", "GOVERNANCE"],
      index: true,
    },
    category: {
      type: String,
      enum: [
        "IDENTITY",
        "ACCOUNTS",
        "ACCESS_ITEMS",
        "MANAGER",
        "SOD",
        "UNCORRELATED_ACCOUNTS",
        "ROLE_COMPOSITION",
        "LIFECYCLE_STATUS",
        "POLICIES",
        "ROLE_MEMBERSHIP",
        "APPROVAL_OWNERSHIP",
      ],
      required: true,
      index: true,
    },
    campaignMode: {
      type: String,
      enum: ["ALL_ACCESS", "PRIVILEGED_ONLY", "IDENTITY", "MANAGER"],
      index: true,
    },
    accessFilter: {
      type: String,
      enum: ["ALL", "PRIVILEGED"],
      default: "ALL",
    },
    identityMode: {
      type: String,
      enum: ["ALL", "SPECIFIC"],
      default: "SPECIFIC",
    },
    identityFilter: {
      type: String,
      enum: ["ALL", "NHI", "CONTRACTOR"],
      index: true,
    },
    selectedIds: [{ type: String }],

    /**
     * Future-proof scope filter object for PROFILE certifications.
     * Use `scopeFilters.managerIds` for Manager Certification scope.
     * Extend with departments, locations, riskTier, etc. without schema migrations.
     */
    scopeFilters: {
      managerIds:  [{ type: mongoose.Schema.Types.ObjectId }],
      departments: [{ type: String }],
      locations:   [{ type: String }],
      riskTier:    { type: String, enum: ["HIGH", "MEDIUM", "LOW", null], default: null },
    },

    // Status / lifecycle
    status: {
      type: String,
      enum: [
        "Draft",
        "Staged", // scope generated, awaiting admin activation
        "Scheduled",
        "Active",
        "EndPhase", // due date passed, owner action pending
        "DecisionPending",
        "Completed",
        "Closed",
      ],
      default: "Staged",
      index: true,
    },

    // Timeline
    startDate: { type: Date, index: true },
    dueDate: { type: Date, index: true },
    endDate: { type: Date },

    // Recurrence / scheduling
    recurrenceRule: { type: String },
    recurrenceEnabled: { type: Boolean, default: false, index: true },
    nextRunDate: { type: Date, index: true },

    // Reminders & escalation
    reminderFrequency: {
      type: String,
      enum: ["GLOBAL", "WEEKLY", "MONTHLY", "TWO_DAYS_BEFORE_END", "DISABLED"],
    },
    escalationConfig: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Reviewers
    /** DEFAULT = per-subject manager; INTERNAL = one chosen manager; EXTERNAL = external email(s) */
    reviewerRoutingMode: {
      type: String,
      enum: ["DEFAULT", "INTERNAL", "EXTERNAL"],
      index: true,
    },
    reviewersAssigned: [reviewerAssignmentSchema],

    /**
     * Backup reviewer for manager-routed identity campaigns (PROFILE scope).
     * Used when a scoped identity has no managerEmail available.
     */
    backupManagerReviewerEmail: { type: String },
    backupManagerReviewerName:  { type: String },
    backupReviewerSource: { type: String, enum: ['INTERNAL', 'EXTERNAL'] },

    results: [{ type: mongoose.Schema.Types.Mixed }],
    history: [{ type: mongoose.Schema.Types.Mixed }],

    // Metrics
    totalScope: { type: Number },

    // Progress (kept for compatibility)
    totalItems: { type: Number, default: 0 },
    completedItems: { type: Number, default: 0 },
    approvedItems: { type: Number, default: 0 },
    revokedItems: { type: Number, default: 0 },
    pendingItems: { type: Number, default: 0 },
    completionPercentage: { type: Number, default: 0 },

    // Owner / Admin action tracking (set after expiry decisions)
    ownerAction: {
      type: String,
      enum: ["NONE", "EXTEND", "CLOSE"],
      default: "NONE",
    },
    adminAction: {
      type: String,
      enum: ["NONE", "APPROVE_ALL", "REVOKE_ALL", "EXTEND"],
      default: "NONE",
    },
    ownerActionEmailSentAt: { type: Date },

    // Metadata
    sourceContext: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "access_certification_campaigns" },
);

campaignSchema.index({ status: 1, dueDate: 1 });
campaignSchema.index({ recurrenceEnabled: 1, nextRunDate: 1 });
campaignSchema.index({ applicationId: 1, category: 1 });
campaignSchema.index({ tenantId: 1, status: 1, dueDate: 1 });
campaignSchema.index({ tenantId: 1, name: 1 });

export default mongoose.model("Campaign", campaignSchema);
