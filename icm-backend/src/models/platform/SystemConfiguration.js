import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    category: {
      type: String,
      enum: ['auth', 'mail', 'security', 'ui', 'general', 'compliance', 'deployment'],
      default: 'general',
    },
    description: { type: String },
    isSecret: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'system_configurations' }
);

export default mongoose.model('SystemConfiguration', systemConfigSchema);
