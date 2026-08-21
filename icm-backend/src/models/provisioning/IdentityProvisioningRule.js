import mongoose from "mongoose";

/**
 * Identity Provisioning Rules — WHO gets access (Joiner birthright).
 * Separate from ProvisioningPolicy (HOW account attributes are built).
 *
 * Conditions evaluate authoritative HRMS Identity attributes only
 * (department, location, …) — never target AD memberOf.
 */

const conditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    operator: {
      type: String,
      enum: [
        "equals",
        "notEquals",
        "contains",
        "notContains",
        "startsWith",
        "endsWith",
        "regex",
      ],
      default: "equals",
    },
    value: { type: String, required: true },
    caseSensitive: { type: Boolean, default: false },
  },
  { _id: false },
);

const actionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "ENSURE_ACCOUNT",
        "ENSURE_ENTITLEMENT",
        "REMOVE_ENTITLEMENT",
        "DISABLE_ACCOUNT",
        "ENABLE_ACCOUNT",
      ],
      required: true,
      default: "ENSURE_ACCOUNT",
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
    },
    /** Generic desired account attributes. Connector-specific translation remains downstream. */
    attributes: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** Existing Entitlement catalog IDs and/or stable entitlement names. */
    entitlementIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Entitlement" }],
    entitlementNames: [{ type: String }],
    /** Existing Role catalog IDs; resolved into their mandatory entitlements at decision time. */
    roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],
  },
  { _id: false },
);

const identityProvisioningRuleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    /** Profile whose mapped identity attributes define this rule's condition fields. */
    identityProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IdentityProfile",
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String },
    enabled: { type: Boolean, default: true, index: true },
    priority: { type: Number, default: 100, index: true },
    /** AND across conditions for MVP */
    conditionLogic: { type: String, enum: ["AND", "OR"], default: "AND" },
    conditions: { type: [conditionSchema], default: [] },
    actions: { type: [actionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "identity_provisioning_rules" },
);

identityProvisioningRuleSchema.index({ tenantId: 1, name: 1 }, { unique: true });
identityProvisioningRuleSchema.index({ tenantId: 1, enabled: 1, priority: 1 });

export default mongoose.model(
  "IdentityProvisioningRule",
  identityProvisioningRuleSchema,
);
