import mongoose from 'mongoose';

const privilegedAccessRecordSchema = new mongoose.Schema(
  {
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entitlement', index: true },
    privilegeType: { type: String, index: true, enum: ['ADMIN', 'SUPER_USER', 'PRIVILEGED_GROUP', 'ROOT'] },
    detectedAt: { type: Date, index: true },
    lastCertifiedAt: { type: Date },
    nextCertificationDue: { type: Date, index: true },
    certificationStatus: { type: String, index: true, enum: ['CURRENT', 'OVERDUE', 'PENDING'] },
    riskScore: { type: Number, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'privileged_access_records' }
);

export default mongoose.model('PrivilegedAccessRecord', privilegedAccessRecordSchema);

