import mongoose from 'mongoose';

const applicationTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String },
    icon: { type: String },
    category: { type: String, enum: ['infrastructure', 'business', 'cloud', 'security', 'custom'], default: 'custom' },
    defaultFields: [{ name: String, type: String, required: Boolean }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'applicationtypes' }
);

export default mongoose.model('ApplicationType', applicationTypeSchema);
