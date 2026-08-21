import mongoose from "mongoose";

/**
 * Per-account sync fingerprint for hash-based incremental reconciliation.
 * Avoids full dataset comparison on every AD / connector sync.
 */
const identitySyncStateSchema = new mongoose.Schema(
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
    /** Normalized primary-key identity key. */
    identityKey: { type: String, required: true, index: true },
    /** Live user document _id in the dynamic users collection. */
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    objectGuid: { type: String, index: true },
    accountHash: { type: String, required: true },
    membershipHash: { type: String, default: "" },
    /** Incremented when hash canonicalization algorithm changes. */
    hashVersion: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: Date.now },
    lastSyncRunId: { type: String, default: "" },
  },
  { timestamps: true, collection: "identity_sync_state" },
);

identitySyncStateSchema.index(
  { applicationId: 1, identityKey: 1 },
  { unique: true },
);
identitySyncStateSchema.index({ applicationId: 1, accountHash: 1 });

export default mongoose.model("IdentitySyncState", identitySyncStateSchema);
