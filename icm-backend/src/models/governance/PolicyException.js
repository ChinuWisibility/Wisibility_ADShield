import mongoose from "mongoose";

const policyExceptionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    policyType: {
      type: String,
      index: true,
      enum: ["SOD", "CERTIFICATION", "PROVISIONING", "PASSWORD"],
    },
    policyId: { type: mongoose.Schema.Types.ObjectId, index: true },
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      index: true,
    },
    exceptionReason: { type: String },
    riskAcceptance: { type: String },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    validFrom: { type: Date, index: true },
    validTo: { type: Date, index: true },
    status: {
      type: String,
      index: true,
      enum: ["PENDING", "ACTIVE", "EXPIRED", "REVOKED"],
      default: "PENDING",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "policy_exceptions" },
);

export default mongoose.model("PolicyException", policyExceptionSchema);
