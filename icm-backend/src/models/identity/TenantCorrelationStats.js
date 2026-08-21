import mongoose from "mongoose";

/**
 * Cached tenant-level correlation rollups (large tenants: avoid full scans on every list request).
 * Refreshed after manual correlation runs and orphan remediation.
 */
const tenantCorrelationStatsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true,
      index: true,
    },
    correlatedLinksCount: { type: Number, default: 0 },
    orphansOpenCount: { type: Number, default: 0 },
    orphansHighRiskCount: { type: Number, default: 0 },
    distinctTargetApplicationsCount: { type: Number, default: 0 },
    /** Set when tenant rollups are recomputed (e.g. after correlation engine). */
    lastCorrelationRunAt: { type: Date },
    /** Total rows in account warehouse for this tenant (for coverage %). */
    totalWarehouseAccountsCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "tenant_correlation_stats" },
);

export default mongoose.model("TenantCorrelationStats", tenantCorrelationStatsSchema);
