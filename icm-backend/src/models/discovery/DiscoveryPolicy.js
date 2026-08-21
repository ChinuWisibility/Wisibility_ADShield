import mongoose from 'mongoose';

/* ── Condition: single operator + value check ──────────────────────── */
const conditionSchema = new mongoose.Schema(
  {
    operator: {
      type: String,
      enum: ['contains', 'equals', 'startsWith', 'endsWith', 'regex', 'notContains', 'notEquals'],
      required: true,
      default: 'contains',
    },
    value: { type: String, required: true, trim: true },
    caseSensitive: { type: Boolean, default: false },
  },
  { _id: false },
);

/* ── FieldCondition: one field with multiple conditions ────────────── */
const fieldConditionSchema = new mongoose.Schema(
  {
    fieldName: { type: String, required: true, trim: true },
    conditionLogic: { type: String, enum: ['AND', 'OR'], default: 'OR' },
    conditions: [conditionSchema],
  },
  { _id: false },
);

/* ── Step: group of field conditions ───────────────────────────────── */
const stepSchema = new mongoose.Schema(
  {
    stepOrder: { type: Number, default: 0 },
    fieldLogic: { type: String, enum: ['AND', 'OR'], default: 'OR' },
    fieldConditions: [fieldConditionSchema],
  },
  { _id: true }, // steps get _id so the UI can reference them
);

/* ── DiscoveryPolicy ───────────────────────────────────────────────── */
const discoveryPolicySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },

    /** Human-facing identifier, e.g. "DISC-101". */
    policyId: { type: String, index: true },
    name: { type: String, required: true, trim: true, minlength: 1 },
    description: { type: String },

    /** What entity this policy evaluates. */
    type: {
      type: String,
      enum: ['USER', 'ENTITLEMENT', 'AD_GROUP'],
      required: true,
      index: true,
    },

    /** Scoped to ONE application. */
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    applicationName: { type: String },

    /** Logic between steps. */
    stepLogic: { type: String, enum: ['AND', 'OR'], default: 'OR' },

    /** Ordered list of evaluation steps. */
    steps: {
      type: [stepSchema],
      validate: {
        validator(steps) {
          if (!Array.isArray(steps) || !steps.length) return false;
          return steps.some((step) =>
            (step.fieldConditions || []).some(
              (fc) =>
                String(fc.fieldName || '').trim() &&
                (fc.conditions || []).some((c) => String(c?.value ?? '').trim()),
            ),
          );
        },
        message: 'At least one condition value is required',
      },
    },

    // ── Stats ──
    totalMatches: { type: Number, default: 0 },
    lastEvaluatedAt: { type: Date },

    owner: { type: String },
    tags: [String],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'discovery_policies' },
);

discoveryPolicySchema.index({ tenantId: 1, applicationId: 1 });
discoveryPolicySchema.index(
  { tenantId: 1, policyId: 1 },
  { unique: true, partialFilterExpression: { policyId: { $exists: true, $gt: '' } } },
);

export default mongoose.model('DiscoveryPolicy', discoveryPolicySchema);
