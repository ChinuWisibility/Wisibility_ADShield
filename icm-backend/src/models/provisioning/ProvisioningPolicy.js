import mongoose from "mongoose";

const provisioningPolicySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    policyName: { type: String, required: true },
    triggerEvent: {
      type: String,
      enum: ["JOINER", "MOVER", "LEAVER", "REHIRE", "CONTRACTOR_START", "CONTRACTOR_END"],
      index: true,
    },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IdentityProfile",
      index: true,
    },
    applications: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    ],
    actions: [mongoose.Schema.Types.Mixed],
    /** Stable ordering when policies contribute to the same desired application. */
    priority: { type: Number, default: 100, index: true },
    approvalRequired: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "provisioning_policies" },
);

provisioningPolicySchema.index({ tenantId: 1, isActive: 1, triggerEvent: 1, priority: 1 });
provisioningPolicySchema.index({ tenantId: 1, policyName: 1 });

export default mongoose.model("ProvisioningPolicy", provisioningPolicySchema);
