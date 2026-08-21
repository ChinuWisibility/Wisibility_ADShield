import mongoose from "mongoose";

/**
 * Cached per-tenant Data Hygiene dashboard summary (full GET /summary payload).
 * Updated by {@link recomputeDataHygieneSummary} after sync, correlation, orphan remediation, and Refresh.
 */
const dataHygieneTenantSummarySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true,
      index: true,
    },
    /** Exact summary object returned by computeDataHygieneSummary (KPIs + widgets + tiles). */
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    computedAt: { type: Date, required: true },
    /** Bump when payload shape changes so stale docs are treated as a miss. */
    version: { type: Number, required: true, default: 1 },
    /** Rollup-derived freshness snapshot (Phase 4). */
    freshness: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "data_hygiene_tenant_summaries" },
);

export default mongoose.model("DataHygieneTenantSummary", dataHygieneTenantSummarySchema);
