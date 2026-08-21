import mongoose from "mongoose";

const accessRequestSchema = new mongoose.Schema(
  {
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      required: true,
      index: true,
    },
    requestType: {
      type: String,
      enum: ["ACCESS", "ROLE", "APPLICATION"],
      index: true,
    },
    targetApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    targetEntitlements: [String],
    targetRoleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },
    justification: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING",
        "APPROVED",
        "REJECTED",
        "PROVISIONING",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "DRAFT",
      index: true,
    },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    sodCheckResult: {
      type: String,
      enum: ["PASS", "CONFLICT", "EXCEPTION_REQUIRED"],
    },
    conflictingPolicies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "SodPolicy" },
    ],
    provisioningRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProvisioningRequest",
    },
    validTo: { type: Date, index: true },
    submittedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "access_requests" },
);

export default mongoose.model("AccessRequest", accessRequestSchema);
