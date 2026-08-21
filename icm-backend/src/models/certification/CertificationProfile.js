import mongoose from "mongoose";

const SUPPORTED_PROFILE_CATEGORIES = ["IDENTITY", "MANAGER", "ACCESS_ITEMS"];

const identityDefaultsSchema = new mongoose.Schema(
  {
    identityMode: {
      type: String,
      enum: ["ALL", "SPECIFIC"],
      default: "SPECIFIC",
    },
    identityFilter: {
      type: String,
      enum: ["ALL", "NHI", "CONTRACTOR"],
      default: "ALL",
    },
    reviewerMode: {
      type: String,
      enum: ["DEFAULT", "INTERNAL", "EXTERNAL"],
      default: "DEFAULT",
    },
  },
  { _id: false },
);

const managerDefaultsSchema = new mongoose.Schema(
  {
    reviewerResolution: {
      type: String,
      enum: ["AUTO_MANAGER", "SELECTED_REVIEWERS"],
      default: "AUTO_MANAGER",
    },
  },
  { _id: false },
);

const accessItemsDefaultsSchema = new mongoose.Schema(
  {
    accessFilter: {
      type: String,
      enum: ["ALL", "PRIVILEGED"],
      default: "ALL",
    },
    reviewerMode: {
      type: String,
      enum: ["DEFAULT", "INTERNAL", "EXTERNAL"],
      default: "DEFAULT",
    },
  },
  { _id: false },
);

const certificationProfileSchema = new mongoose.Schema(
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
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["ACTIVE", "ARCHIVED"],
      default: "ACTIVE",
      index: true,
    },
    supportedCategories: {
      type: [{ type: String, enum: SUPPORTED_PROFILE_CATEGORIES }],
      default: SUPPORTED_PROFILE_CATEGORIES,
    },
    defaults: {
      identity: { type: identityDefaultsSchema, default: () => ({}) },
      manager: { type: managerDefaultsSchema, default: () => ({}) },
      accessItems: { type: accessItemsDefaultsSchema, default: () => ({}) },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    collection: "access_certification_profiles",
  },
);

certificationProfileSchema.index(
  { tenantId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: "ARCHIVED" } },
  },
);

export { SUPPORTED_PROFILE_CATEGORIES };
export default mongoose.model(
  "CertificationProfile",
  certificationProfileSchema,
);
