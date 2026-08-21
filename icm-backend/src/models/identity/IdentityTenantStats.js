import mongoose from "mongoose";

/**
 * Cached per-tenant identity rollups for dashboard cards (avoid full-table scans on every list request).
 * Updated by {@link recomputeIdentityTenantStats} after identity refresh, mapping save, and identity CRUD.
 */
const identityTenantStatsSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true },
    total: { type: Number, default: 0 },
    active: { type: Number, default: 0 },
    /** Elevated / non-employee accounts: HIGH/CRITICAL risk or service, vendor, NHI identity types. */
    privileged: { type: Number, default: 0 },
    /** Non-ACTIVE lifecycle (excludes ACTIVE only; includes leaver, terminated, mover, quarantine, NEW, etc.). */
    inactive: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "identity_tenant_stats" },
);

export default mongoose.model("IdentityTenantStats", identityTenantStatsSchema);
