import mongoose from "mongoose";

/** Extensible metric keys for ISO Thresholds risk-band cards. */
export const GOVERNANCE_RISK_BAND_METRIC_KEYS = [
  "orphan_uncorrelated_share",
  "active_users_share",
  "inactive_users_share",
  "privileged_users_share",
];

const governanceRiskBandSettingSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    metricKey: {
      type: String,
      required: true,
      enum: GOVERNANCE_RISK_BAND_METRIC_KEYS,
      default: "orphan_uncorrelated_share",
    },
    /** First boundary A: Low is pct < A; Medium is A <= pct < B */
    mediumStartsAtPct: { type: Number, required: true, min: 0.0001, max: 99.9999 },
    /** Second boundary B: High band is B <= pct < C */
    highStartsAtPct: { type: Number, required: true, min: 0.0001, max: 100 },
    /** Third boundary C: Critical is pct >= C (stored 1–99; legacy docs may omit) */
    criticalStartsAtPct: { type: Number, min: 0.0001, max: 99.9999 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "governance_risk_band_settings" },
);

governanceRiskBandSettingSchema.index(
  { tenantId: 1, applicationId: 1, metricKey: 1 },
  { unique: true },
);

export default mongoose.model("GovernanceRiskBandSetting", governanceRiskBandSettingSchema);
