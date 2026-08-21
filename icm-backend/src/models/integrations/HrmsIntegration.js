import mongoose from 'mongoose';

/**
 * Tenant-scoped HRMS (e.g. OrangeHRM) OAuth + authoritative source settings.
 * Links identities from HRMS into IGA and optionally marks which Application is the AD/directory feed target.
 */
const hrmsIntegrationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    /** User-visible label in the HRMS sources table (unique per tenant). */
    name: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    /** Connector type shown in IGA; drives which configuration UI and sync path apply. */
    connector: {
      type: String,
      enum: ['orangehrm', 'delimited_file'],
      default: 'orangehrm',
    },
    provider: { type: String, enum: ['orangehrm', 'generic_oauth'], default: 'orangehrm' },
    displayName: { type: String, default: 'OrangeHRM' },
    /** Base URL without trailing slash, e.g. http://localhost/orangehrm */
    baseUrl: { type: String, trim: true, default: '' },
    clientId: { type: String, trim: true, default: '' },
    clientSecret: { type: String, default: '' },
    /** Optional overrides; defaults derived from baseUrl for OrangeHRM */
    authorizePath: { type: String, default: '/web/index.php/oauth2/authorize' },
    tokenPath: { type: String, default: '/web/index.php/oauth2/token' },
    /** Optional override for employee list GET, e.g. /web/index.php/api/v1/employees (default tries common paths). */
    employeesApiPath: { type: String, trim: true, default: '' },
    accessToken: { type: String, default: '' },
    refreshToken: { type: String, default: '' },
    tokenExpiresAt: { type: Date },
    connectionStatus: {
      type: String,
      enum: ['disconnected', 'connected', 'error'],
      default: 'disconnected',
    },
    lastError: { type: String },
    lastAuthorizedAt: { type: Date },
    /** Application (e.g. Active Directory) that receives downstream provisioning / sync in HRMS → IGA → AD */
    directoryTargetApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      default: null,
    },
    /** When false, this source is excluded from imports and delimited upload until re-enabled. */
    isActive: { type: Boolean, default: true, index: true },
    /** Parsed from the latest delimited CSV upload (connector === delimited_file). Used for identity profile mapping. */
    delimitedCsvHeaders: { type: [String], default: [] },
    delimitedPreviewRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Up to N full rows from the last upload for import-into-identities (not returned in list APIs). */
    delimitedImportRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    delimitedRowCount: { type: Number },
    delimitedLastUploadAt: { type: Date },
    delimitedLastFileName: { type: String, trim: true, default: '' },
    /** When true, identities for this tenant are expected to be mastered from HRMS after sync jobs are wired */
    authoritativeIdentitySource: { type: Boolean, default: false },
    lastIdentitySyncAt: { type: Date },
    lastIdentitySyncCount: { type: Number },
    lastIdentitySyncError: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'hrms_integrations' }
);

hrmsIntegrationSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model('HrmsIntegration', hrmsIntegrationSchema);
