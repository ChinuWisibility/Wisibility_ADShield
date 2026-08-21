import mongoose from "mongoose";

const entitlementOwnershipReviewSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    entitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entitlement",
      required: true,
      index: true,
    },
    currentOwner: { type: String },
    reviewStatus: {
      type: String,
      index: true,
      enum: ["PENDING", "CONFIRMED", "CHANGED", "REVOKED"],
      default: "PENDING",
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    newOwner: { type: String },
    reviewedAt: { type: Date },
    nextReviewDate: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "entitlement_ownership_reviews" },
);

export default mongoose.model(
  "EntitlementOwnershipReview",
  entitlementOwnershipReviewSchema,
);
