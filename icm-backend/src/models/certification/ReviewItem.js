import mongoose from "mongoose";

/** Atomic certification review unit — source of truth for item-level status/decisions. */
const reviewItemSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    userId: { type: String, required: true },
    userPrimaryKey:    { type: String },
    managerPrimaryKey: { type: String },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    category: { type: String },
    /** Canonical key aligned with scope / selectedIds */
    itemId: { type: String, required: true },
    itemName: { type: String },

    /* ── Identity snapshot — captured at campaign creation time ──────── */
    itemEmail: { type: String },
    itemDepartment: { type: String },
    itemTitle: { type: String },
    itemManager: { type: String },
    itemManagerEmail: { type: String },
    itemApplicationName: { type: String },
    /** Entitlements / access groups assigned to this user at snapshot time */
    itemAccessDetails: [{ type: String }],

    /** Per-entitlement decisions (SailPoint-style granular review). Populated from itemAccessDetails at campaign generation.
     *  When present, each entry tracks its own approve/revoke independently of the top-level status. */
    entitlementDecisions: [
      {
        _id: false,
        entitlementName: { type: String, required: true },
        applicationName: { type: String },
        applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
        status: {
          type: String,
          enum: ["PENDING", "APPROVED", "REVOKED", "REVOKE_IN_PROGRESS"],
          default: "PENDING",
        },
        decision: { type: String },
        comment: { type: String },
        reviewedAt: { type: Date },
        remediationRequired: { type: Boolean, default: false },
        /** Remediation workflow selected at revoke time + its execution tracking. */
        remediationWorkflowId: { type: String },
        remediationExecutionId: { type: String },
        remediationStatus: {
          type: String,
          enum: [
            "PENDING",
            "RUNNING",
            "WAITING_ITSM",
            "COMPLETED",
            "FAILED",
            "SKIPPED",
            "REVOKE_IN_PROGRESS",
            null,
          ],
          default: null,
        },
        provisioningStatus: {
          type: String,
          enum: ["PENDING", "EXECUTED", "FAILED", null],
          default: null,
        },
      },
    ],

    reviewerEmail: {
      type: String,
      required: false,
      default: "",
      lowercase: true,
      trim: true,
      index: true,
    },
    /** ObjectId ref when the reviewer is an internal User; null for external/email-only reviewers. */
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      sparse: true,
    },
    /**
     * ID-first reviewer reference pointing to the Identity who is the reviewer.
     * Stable even when managerEmail changes. Used for PROFILE certification where
     * the reviewer is a manager Identity (not a platform User).
     */
    reviewerIdentityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      index: true,
      sparse: true,
    },
    reviewerName: { type: String },
    /** Immutable snapshot of the assigned reviewer captured at item creation.
     *  Preserved even if the reviewer is later reassigned or changes their email. */
    reviewerSnapshot: {
      _id: false,
      reviewerId: { type: mongoose.Schema.Types.ObjectId },
      email:       { type: String },
      name:        { type: String },
      source:      { type: String },
      snapshotAt:  { type: Date },
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REVOKED", "REVOKE_IN_PROGRESS", "DELEGATED", "EXCEPTION"],
      default: "PENDING",
      index: true,
    },
    decision: { type: String },
    comment: { type: String },
    reviewedAt: { type: Date },
    /** Which surface the decision came from — populated alongside reviewedAt. */
    decisionSource: {
      type: String,
      enum: ["CONSOLE", "EMAIL_LINK", "PORTAL", "SYSTEM"],
    },
    /** IP address at time of last decision — best-effort, may be absent for system actions. */
    ipAddress: { type: String },
    provisioningStatus: {
      type: String,
      enum: ["PENDING", "EXECUTED", "FAILED"],
    },

    /** Item-level remediation workflow (when the whole item is revoked). */
    remediationWorkflowId: { type: String },
    remediationExecutionId: { type: String },
    remediationStatus: {
      type: String,
      enum: [
        "PENDING",
        "RUNNING",
        "WAITING_ITSM",
        "COMPLETED",
        "FAILED",
        "SKIPPED",
        "REVOKE_IN_PROGRESS",
        null,
      ],
      default: null,
    },

    /**
     * Frozen snapshot of the entitlement as it existed at certification activation time.
     * Mandatory for audit integrity — entitlement names/risk levels may change after activation.
     * Reviewers always see what was true when the campaign started.
     */
    entitlementSnapshot: {
      _id: false,
      applicationId:   { type: mongoose.Schema.Types.ObjectId },
      applicationName: { type: String },
      entitlementId:   { type: String },    // native ID from source system
      entitlementName: { type: String },
      riskLevel:       { type: String, enum: ["HIGH", "MEDIUM", "LOW", "NONE", null] },
      isPrivileged:    { type: Boolean, default: false },
      snapshotAt:      { type: Date },
    },

    /**
     * Action to execute when this review item is revoked.
     * Populated at review item creation so the provisioning engine has a
     * ready-made, immutable action descriptor — no post-decision redesign needed.
     */
    provisioningAction: {
      type: String,
      enum: [null, "REMOVE_ENTITLEMENT", "DISABLE_ACCOUNT", "NOTIFY_OWNER"],
      default: null,
    },

    /**
     * Immutable payload for the provisioning engine — captured once at item creation.
     * Contains everything needed to execute the revoke action without re-querying live data.
     */
    provisioningPayload: {
      _id: false,
      identityId:      { type: mongoose.Schema.Types.ObjectId },
      applicationId:   { type: mongoose.Schema.Types.ObjectId },
      entitlementId:   { type: String },
      entitlementName: { type: String },
      nativeIdentity:  { type: String },   // account login/username in the source system
      applicationName: { type: String },
    },

    /** Enterprise UX: explicit marker for identities with no access. */
    reviewItemType: {
      type: String,
      enum: ["ENTITLEMENT", "NO_ACCESS"],
      default: "ENTITLEMENT",
      index: true,
    },
  },
  { timestamps: true, collection: "review_items" },
);

/** One row per user + access item within a campaign (same entitlement can apply to multiple users). */
reviewItemSchema.index(
  { campaignId: 1, userId: 1, itemId: 1 },
  { unique: true },
);
reviewItemSchema.index({ campaignId: 1, reviewerEmail: 1, status: 1 });
reviewItemSchema.index({ campaignId: 1, status: 1 });

export default mongoose.model("ReviewItem", reviewItemSchema);
