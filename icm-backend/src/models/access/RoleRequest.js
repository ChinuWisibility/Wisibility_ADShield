import mongoose from "mongoose";

const roleRequestSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      required: true,
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    requestType: { type: String, enum: ["ADD", "REMOVE", "MODIFY"] },
    justification: { type: String },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"],
      default: "PENDING",
      index: true,
    },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewComment: { type: String },
    sodCheckResult: {
      type: String,
      enum: ["PASS", "CONFLICT", "EXCEPTION_REQUIRED"],
    },
    conflictingRules: [
      { type: mongoose.Schema.Types.ObjectId, ref: "SodRule" },
    ],
    validTo: { type: Date },
    submittedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "role_requests" },
);

export default mongoose.model("RoleRequest", roleRequestSchema);
