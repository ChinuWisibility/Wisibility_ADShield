import mongoose from "mongoose";

const entitlementHierarchySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    parentEntitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entitlement",
      required: true,
      index: true,
    },
    childEntitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entitlement",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    relationship: { type: String, enum: ["CONTAINS", "IMPLIES", "CONFLICTS"] },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "entitlement_hierarchies" },
);

export default mongoose.model(
  "EntitlementHierarchy",
  entitlementHierarchySchema,
);
