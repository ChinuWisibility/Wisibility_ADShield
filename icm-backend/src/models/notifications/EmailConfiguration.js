import mongoose from 'mongoose';

const emailConfigurationSchema = new mongoose.Schema(
  {
    provider: { type: String, index: true, enum: ['SMTP', 'SENDGRID', 'SES', 'MAILGUN'] },
    host: { type: String },
    port: { type: Number },
    useTLS: { type: Boolean, default: true },
    fromAddress: { type: String },
    fromName: { type: String },
    apiKeyEncrypted: { type: String, select: false },
    usernameEncrypted: { type: String, select: false },
    passwordEncrypted: { type: String, select: false },
    isActive: { type: Boolean, index: true, default: true },
    testStatus: { type: String, enum: ['UNTESTED', 'PASS', 'FAIL'], default: 'UNTESTED' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'email_configurations' }
);

export default mongoose.model('EmailConfiguration', emailConfigurationSchema);

