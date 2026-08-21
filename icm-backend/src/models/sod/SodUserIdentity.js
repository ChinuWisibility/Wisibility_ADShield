import mongoose from "mongoose";

/**
 * SoD user identity snapshot used for:
 * - violation enrichment (name/email/department)
 * - reviewer selection for SoD certifications
 *
 * Stored as a lightweight, tenant-scoped projection of Identity/Account data.
 */
const sodUserIdentitySchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    userId: { type: String, required: true, index: true },
    displayName: { type: String },
    name: { type: String },
    email: { type: String, index: true },
    department: { type: String, index: true },
    title: { type: String },
    status: { type: String, default: "Active", index: true },
    isManager: { type: Boolean, default: false, index: true },
    managerName: { type: String },
    managerEmail: { type: String, index: true },
  },
  { timestamps: true, collection: "sod_user_identities" },
);

sodUserIdentitySchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export default mongoose.model("SodUserIdentity", sodUserIdentitySchema);

