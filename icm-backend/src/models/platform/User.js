import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    username: { type: String, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity' },
    role: {
      type: String,
      enum: ['admin', 'superAdmin', 'certAdmin', 'sodAdmin', 'manager', 'viewer', 'auditAnalytics'],
      default: 'viewer',
    },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
    /**
     * ONBOARDING: Identity New Identity flow — cannot use normal login until
     * Create Own Password completes. ACTIVE: normal authentication (default
     * for Users & Roles and existing accounts).
     */
    passwordStatus: {
      type: String,
      enum: ['ACTIVE', 'ONBOARDING'],
      default: 'ACTIVE',
      index: true,
    },
    lastLogin: { type: Date },
    profilePicture: { type: String },
    department: { type: String },
    phoneNumber: { type: String },
    mfaEnabled: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  },
  { timestamps: true, collection: 'users' }
);

// Sparse so existing portal users without a username/identity link remain valid.
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ identityId: 1 }, { unique: true, sparse: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.model('User', userSchema);
