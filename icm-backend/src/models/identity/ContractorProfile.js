import mongoose from 'mongoose';

const contractorProfileSchema = new mongoose.Schema(
  {
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', required: true, index: true },
    contractType: { type: String, enum: ['FIXED_TERM', 'SOW', 'VENDOR'] },
    vendorName: { type: String, index: true },
    engagingManagerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity' },
    startDate: { type: Date },
    endDate: { type: Date, index: true },
    renewalCount: { type: Number },
    ndaSigned: { type: Boolean },
    backgroundCheckPassed: { type: Boolean },
    accessApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, index: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'contractor_profiles' }
);

export default mongoose.model('ContractorProfile', contractorProfileSchema);

