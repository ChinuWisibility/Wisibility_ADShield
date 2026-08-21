import mongoose from "mongoose";

/**
 * Persistent storage for AD security posture scan snapshots.
 * One document per scan run; shape mirrors the legacy JSON file payload so
 * downstream modules can query indexed fields or read the full scan blob.
 */
const postureScanResultSchema = new mongoose.Schema(
  {
    scanId: { type: String, required: true, unique: true, index: true },
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
    /**
     * Parent Assessment (AdSecurityAssessment). Nullable for legacy scans.
     * PostureScanResult remains the Assessment Execution store.
     */
    assessmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdSecurityAssessment",
      default: null,
      index: true,
    },
    /**
     * Assessment Version whose frozen config drove this execution.
     * Nullable for legacy executions (pre-versioning).
     */
    assessmentVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdSecurityAssessmentVersion",
      default: null,
      index: true,
    },
    status: { type: String, default: "completed", index: true },
    startedAt: { type: Date, index: true },
    completedAt: { type: Date, index: true },
    modules: [{ type: String }],
    results: { type: mongoose.Schema.Types.Mixed, default: [] },
    findings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    scanConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    diagnostics: { type: [mongoose.Schema.Types.Mixed], default: [] },
    policySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "posture_scan_results" },
);

postureScanResultSchema.index({ applicationId: 1, completedAt: -1 });
postureScanResultSchema.index({ tenantId: 1, applicationId: 1, completedAt: -1 });
postureScanResultSchema.index({ tenantId: 1, completedAt: -1 });
postureScanResultSchema.index({ assessmentId: 1, completedAt: -1 });
postureScanResultSchema.index({ applicationId: 1, assessmentId: 1, completedAt: -1 });
postureScanResultSchema.index({ assessmentVersionId: 1, completedAt: -1 });
postureScanResultSchema.index({
  assessmentId: 1,
  assessmentVersionId: 1,
  completedAt: -1,
});

export default mongoose.model("PostureScanResult", postureScanResultSchema);
