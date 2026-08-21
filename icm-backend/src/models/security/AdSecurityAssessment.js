import mongoose from "mongoose";

/**
 * AD Security Assessment — business object with editable Working Configuration.
 * Immutable snapshots live in AssessmentVersion; executions are PostureScanResult.
 */
export const AD_SECURITY_ASSESSMENT_STATUS = {
  DRAFT: "draft",
  CONFIGURED: "configured",
  READY: "ready",
  RUNNING: "running",
  COMPLETED: "completed",
  UNDER_REMEDIATION: "under_remediation",
  REASSESSED: "reassessed",
  CLOSED: "closed",
};

const adSecurityAssessmentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    purpose: { type: String, default: "", trim: true },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(AD_SECURITY_ASSESSMENT_STATUS),
      default: AD_SECURITY_ASSESSMENT_STATUS.DRAFT,
      index: true,
    },
    /**
     * Editable Working Configuration (not version history).
     * Shape mirrors Version configSnapshot:
     * { features[], queryOverrides{}, enabledMap{}, featureSettings{},
     *   securityScanSettings{}, updatedAt, source }
     */
    workingConfiguration: { type: mongoose.Schema.Types.Mixed, default: null },
    latestVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdSecurityAssessmentVersion",
      default: null,
    },
    latestVersionNumber: { type: Number, default: null },
    latestExecutionId: { type: String, default: null },
    executionCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "ad_security_assessments" },
);

adSecurityAssessmentSchema.index({ applicationId: 1, updatedAt: -1 });
adSecurityAssessmentSchema.index({ tenantId: 1, applicationId: 1, updatedAt: -1 });

export default mongoose.model("AdSecurityAssessment", adSecurityAssessmentSchema);
