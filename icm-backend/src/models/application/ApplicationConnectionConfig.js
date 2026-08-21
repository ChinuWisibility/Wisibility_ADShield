import mongoose from 'mongoose';

const applicationConnectionConfigSchema = new mongoose.Schema(
  {
    connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectorConfig', required: true, index: true },
    endpointUrl: { type: String },
    authType: { type: String, enum: ['BASIC', 'OAUTH2', 'API_KEY', 'CERTIFICATE', 'KERBEROS'] },

    usernameEncrypted: { type: String, select: false },
    passwordEncrypted: { type: String, select: false },
    clientId: { type: String },
    clientSecretEncrypted: { type: String, select: false },
    tokenEndpoint: { type: String },
    tlsCertPath: { type: String },
    additionalParams: { type: mongoose.Schema.Types.Mixed },
    testStatus: { type: String, enum: ['UNTESTED', 'PASS', 'FAIL'], default: 'UNTESTED' },
    testedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'application_connection_configs' }
);

applicationConnectionConfigSchema.index({ testStatus: 1 });

export default mongoose.model('ApplicationConnectionConfig', applicationConnectionConfigSchema);

