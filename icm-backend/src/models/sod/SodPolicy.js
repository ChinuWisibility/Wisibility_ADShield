import mongoose from 'mongoose';

const sodPolicySchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    /** Human-facing id, e.g. POL-101 (unique per tenant when set). */
    policyId: { type: String, index: true },
    name: { type: String, required: true },
    description: { type: String },
    status: { type: String, enum: ['active', 'draft', 'disabled', 'archived'], default: 'draft' },
    type: { type: String, enum: ['preventive', 'detective', 'both'], default: 'detective' },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },

    // Scope
    applications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Application' }],
    applicationNames: [String],
    isCrossApplication: { type: Boolean, default: false },

    // Rules
    rules: [{
      name: { type: String },
      description: { type: String },
      leftEntitlements: [{ id: String, name: String, applicationName: String }],
      rightEntitlements: [{ id: String, name: String, applicationName: String }],
      operator: { type: String, enum: ['AND', 'OR'], default: 'AND' },
      isActive: { type: Boolean, default: true },
    }],

    // Stats
    totalViolations: { type: Number, default: 0 },
    openViolations: { type: Number, default: 0 },
    totalExceptions: { type: Number, default: 0 },
    lastScanDate: { type: Date },

    // Risk scoring weights
    riskWeight: { type: Number, default: 1.0, min: 0.1, max: 10.0 },

    // Metadata
    owner: { type: String },
    ownerEmail: { type: String },
    complianceFramework: [String],
    tags: [String],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'sod_policies' }
);

sodPolicySchema.index({ tenantId: 1, status: 1 });
sodPolicySchema.index({ status: 1 });
sodPolicySchema.index({ severity: 1 });
sodPolicySchema.index(
  { tenantId: 1, policyId: 1 },
  {
    unique: true,
    partialFilterExpression: { policyId: { $exists: true, $gt: "" } },
  },
);
/** Soft uniqueness aid; create/update also enforce case-insensitive name checks. */
sodPolicySchema.index({ tenantId: 1, name: 1 });

export default mongoose.model('SodPolicy', sodPolicySchema);
