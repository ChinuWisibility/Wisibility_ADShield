import mongoose from 'mongoose';

const sodViolationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    policy: { type: mongoose.Schema.Types.ObjectId, ref: 'SodPolicy', required: true },
    policyName: { type: String },
    ruleName: { type: String },

    identity: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity' },
    identityName: { type: String },
    identityEmail: { type: String },
    department: { type: String },

    // Conflicting access
    leftEntitlements: [{ name: String, applicationName: String }],
    rightEntitlements: [{ name: String, applicationName: String }],

    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
    status: { type: String, enum: ['open', 'remediated', 'exception_granted', 'false_positive', 'expired'], default: 'open' },
    riskScore: { type: Number, default: 0 },

    // Remediation
    remediationType: { type: String, enum: ['remove_access', 'reassign', 'accept_risk', 'compensating_control'] },
    remediationNotes: { type: String },
    remediatedBy: { type: String },
    remediatedAt: { type: Date },

    // Exception
    exceptionGrantedBy: { type: String },
    exceptionReason: { type: String },
    exceptionExpiry: { type: Date },

    detectedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'sod_violations' }
);

sodViolationSchema.index({ tenantId: 1, detectedAt: -1 });
sodViolationSchema.index({ policy: 1 });
sodViolationSchema.index({ identity: 1 });
sodViolationSchema.index({ status: 1 });
sodViolationSchema.index({ severity: 1 });
sodViolationSchema.index({ detectedAt: -1 });

export default mongoose.model('SodViolation', sodViolationSchema);
