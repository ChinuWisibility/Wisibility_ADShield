import mongoose from "mongoose";

/**
 * Immutable Assessment Version — frozen configuration snapshot.
 * Versions have no draft/edit lifecycle: created only by Execute (or migration).
 */
const adSecurityAssessmentVersionSchema = new mongoose.Schema(
  {
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdSecurityAssessment",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    versionNumber: { type: Number, required: true },
    /** Version 0 = migrated legacy; normal versions start at 1. */
    label: { type: String, default: "", trim: true },
    changeSummary: { type: String, default: "", trim: true },
    /**
     * Frozen effective configuration.
     * Shape: { features[], queryOverrides{}, enabledMap{}, featureSettings{},
     *          securityScanSettings{}, contentFingerprint, frozenAt, migrated? }
     */
    configSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    contentFingerprint: { type: String, default: "", index: true },
    createdFromVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdSecurityAssessmentVersion",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    executionCount: { type: Number, default: 0 },
    latestExecutionId: { type: String, default: null },
  },
  { timestamps: true, collection: "ad_security_assessment_versions" },
);

adSecurityAssessmentVersionSchema.index(
  { assessmentId: 1, versionNumber: 1 },
  { unique: true },
);
adSecurityAssessmentVersionSchema.index({ assessmentId: 1, createdAt: -1 });
adSecurityAssessmentVersionSchema.index({ applicationId: 1, assessmentId: 1 });

export default mongoose.model(
  "AdSecurityAssessmentVersion",
  adSecurityAssessmentVersionSchema,
);
