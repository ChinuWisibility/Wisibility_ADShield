import mongoose from 'mongoose';

const detectionRuleSetSchema = new mongoose.Schema(
  {
    ruleType: {
      type: String,
      enum: ['NHI', 'PRIVILEGED'],
      required: true,
      index: true,
    },
    displayName: { type: String },
    description: { type: String },
    pattern: { type: String },
    field: { type: String },
    confidence: { type: Number },
    isEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    isGlobal: { type: Boolean, default: false },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'detection_rule_sets' }
);

detectionRuleSetSchema.index({ ruleType: 1, isEnabled: 1 });

export default mongoose.model('DetectionRuleSet', detectionRuleSetSchema);

