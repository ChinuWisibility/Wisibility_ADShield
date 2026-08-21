import mongoose from 'mongoose';

const identityAccountLinkSchema = new mongoose.Schema(
  {
    /** Denormalized from identity — enables tenant-scoped list queries without joining all links. */
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    accountId: { type: String, index: true },
    accountName: { type: String },
    correlationMethod: { type: String, enum: ['EMAIL', 'EMPLOYEE_ID', 'MANUAL', 'AI'] },
    correlationScore: { type: Number },
    /** Identity-side attribute used when the link was created (e.g. employeeId, email). */
    correlationIdentityAttribute: { type: String },
    /** Application account field used when the link was created (e.g. samAccountName, employee_id). */
    correlationAccountAttribute: { type: String },
    /** Snapshot of the account attribute value that satisfied the match (display). */
    correlationMatchDisplay: { type: String },
    /** 1-based rule order from the last multi-rule manual correlation run (audit / UI). */
    correlationRulePriority: { type: Number },
    /**
     * Matching outcome (identity found or not). Uncorrelated/ambiguous rows may use CorrelationResult / orphan queue instead.
     */
    correlationStatus: {
      type: String,
      enum: ['correlated', 'uncorrelated', 'ambiguous'],
      default: 'correlated',
    },
    correlationConfidence: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'high',
    },
    /** Governance / anomaly: e.g. identity terminated but account still active — independent of correlation match. */
    orphanReason: { type: String, default: null },
    isOrphan: { type: Boolean, index: true, default: false },
    isActive: { type: Boolean, index: true, default: true },
    remediationStatus: { type: String },
    accessState: { type: String },
    orphanStatus: { type: String },
    lastVerifiedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'identity_account_links' }
);

/** Correlated-accounts list: tenant-scoped active links sorted by recency. */
identityAccountLinkSchema.index({ tenantId: 1, isActive: 1, updatedAt: -1 });
identityAccountLinkSchema.index({ tenantId: 1, isActive: 1, applicationId: 1, updatedAt: -1 });
identityAccountLinkSchema.index({ isActive: 1, updatedAt: -1 });
identityAccountLinkSchema.index({ identityId: 1, isActive: 1 });
identityAccountLinkSchema.index({ applicationId: 1, isActive: 1, identityId: 1 });
identityAccountLinkSchema.index({ identityId: 1, isActive: 1, applicationId: 1 });
identityAccountLinkSchema.index({ applicationId: 1, correlationStatus: 1, isActive: 1 });

export default mongoose.model('IdentityAccountLink', identityAccountLinkSchema);
