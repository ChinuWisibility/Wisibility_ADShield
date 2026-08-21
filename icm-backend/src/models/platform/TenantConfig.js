import mongoose from 'mongoose';

const tenantConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    tenantName: { type: String, required: true },
    licenseType: { type: String, enum: ['trial', 'standard', 'enterprise'], default: 'standard' },
    maxUsers: { type: Number, default: 100 },
    contactEmail: { type: String },
    iamTeamEmail: { type: String, trim: true, lowercase: true, default: '' },
    features: {
      sod: { type: Boolean, default: true },
      certification: { type: Boolean, default: true },
      provisioning: { type: Boolean, default: false },
      roleManagement: { type: Boolean, default: true },
      dataHygiene: { type: Boolean, default: true },
      aiInsights: { type: Boolean, default: false },
      correlationEngine: { type: Boolean, default: false },
      accessIntelligence: { type: Boolean, default: false },
    },
    branding: {
      primaryColor: { type: String, default: '#00A3E0' },
      logo: { type: String },
      favicon: { type: String },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'tenant_configs' }
);

export default mongoose.model('TenantConfig', tenantConfigSchema);
