import mongoose from "mongoose";

/**
 * Tenant-scoped enqueue lock (SAP-style): one identity materialization pipeline per tenant at a time.
 * Prevents overlapping identity-refresh / save+sync jobs across browsers and users.
 */
const tenantMaterializationLockSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Tenant",
      index: true,
    },
    /** Logical lock name; reserved for future split locks. */
    lockKey: { type: String, default: "IDENTITY_MATERIALIZATION", index: true },
    locked: { type: Boolean, default: false },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    ownerEmail: { type: String, default: "" },
    ownerFirstName: { type: String, default: "" },
    ownerLastName: { type: String, default: "" },
    /** identity_refresh | mappings_save_and_sync | bulk_identity_refresh | import_delimited */
    operation: { type: String, default: "" },
    acquiredAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tenantMaterializationLockSchema.index({ tenantId: 1, lockKey: 1 }, { unique: true });

const TenantMaterializationLock =
  mongoose.models.TenantMaterializationLock ||
  mongoose.model("TenantMaterializationLock", tenantMaterializationLockSchema);

export default TenantMaterializationLock;
