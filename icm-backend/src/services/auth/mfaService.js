import crypto from 'crypto';
import MFAConfiguration from '../models/platform/MFAConfiguration.js';
import User from '../models/platform/User.js';
import { AppError } from '../middleware/errorHandler.js';

function generateSecret() {
  return crypto.randomBytes(20).toString('hex');
}

function generateOtpAuthUrl(secret, email) {
  const issuer = 'IGA-Platform';
  return `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
}

function generateTOTP(secret, timeStep = 30) {
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'));
  hmac.update(buf);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const code = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(code % 1000000).padStart(6, '0');
}

export async function getMfaStatus(userId) {
  const config = await MFAConfiguration.findOne({ userId });
  if (!config) {
    return { enrolled: false, mfaType: null, isEnabled: false };
  }
  return { enrolled: true, mfaType: config.mfaType, isEnabled: config.isEnabled, enrolledAt: config.enrolledAt };
}

export async function enrollMfa(userId, { mfaType = 'TOTP' }) {
  const existing = await MFAConfiguration.findOne({ userId, isEnabled: true });
  if (existing) throw new AppError('MFA already enrolled', 409, 'MFA_ALREADY_ENROLLED');

  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const secret = generateSecret();
  const otpAuthUrl = generateOtpAuthUrl(secret, user.email);

  await MFAConfiguration.findOneAndUpdate(
    { userId },
    { userId, mfaType, secret, isEnabled: false, enrolledAt: new Date(), backupCodes: [], createdBy: userId },
    { upsert: true, new: true }
  );

  return { secret, otpAuthUrl, mfaType };
}

export async function setupTotp(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const secret = generateSecret();
  const otpAuthUrl = generateOtpAuthUrl(secret, user.email);

  await MFAConfiguration.findOneAndUpdate(
    { userId },
    { userId, mfaType: 'TOTP', secret, isEnabled: false, enrolledAt: new Date(), createdBy: userId },
    { upsert: true, new: true }
  );

  return { secret, otpAuthUrl };
}

/**
 * Checks a submitted code against the live TOTP code, allowing ±1 time step
 * (30s each way) for clock drift between client and server.
 */
function isValidTotpCode(secret, code) {
  const candidate = String(code || '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const epoch = Math.floor(Date.now() / 1000);
  for (const drift of [0, -1, 1]) {
    const counter = Math.floor(epoch / 30) + drift;
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter & 0xffffffff, 4);
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'));
    hmac.update(buf);
    const hash = hmac.digest();
    const offset = hash[hash.length - 1] & 0xf;
    const code32 = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
    if (String(code32 % 1000000).padStart(6, '0') === candidate) return true;
  }
  return false;
}

async function isValidBackupCode(config, code) {
  const candidate = String(code || '').trim();
  if (!candidate || !Array.isArray(config.backupCodes) || !config.backupCodes.length) return false;
  const hash = crypto.createHash('sha256').update(candidate).digest('hex');
  const idx = config.backupCodes.indexOf(hash);
  if (idx === -1) return false;
  // Single-use — remove it once consumed.
  config.backupCodes.splice(idx, 1);
  return true;
}

export async function verifyMfaToken(userId, { token }) {
  if (!token) throw new AppError('Token is required', 400, 'MISSING_TOKEN');

  const config = await MFAConfiguration.findOne({ userId }).select('+secret');
  if (!config) throw new AppError('MFA not enrolled', 404, 'MFA_NOT_ENROLLED');

  const validTotp = isValidTotpCode(config.secret, token);
  const validBackup = !validTotp && (await isValidBackupCode(config, token));
  if (!validTotp && !validBackup) {
    throw new AppError('Invalid verification code', 401, 'MFA_CODE_INVALID');
  }

  if (!config.isEnabled) {
    config.isEnabled = true;
    config.lastUsedAt = new Date();
    await config.save();
    await User.findByIdAndUpdate(userId, { mfaEnabled: true });
    return { verified: true, message: 'MFA enabled successfully' };
  }

  config.lastUsedAt = new Date();
  await config.save();
  return { verified: true, message: 'Token verified' };
}

/**
 * Verifies an MFA code at login time (after password auth, before issuing a
 * session token). Unlike verifyMfaToken, this never auto-enables MFA — it's
 * only meaningful once MFA is already enabled.
 */
export async function verifyMfaCodeForLogin(userId, code) {
  const config = await MFAConfiguration.findOne({ userId, isEnabled: true }).select('+secret');
  if (!config) throw new AppError('MFA is not enabled for this account', 400, 'MFA_NOT_ENROLLED');

  const validTotp = isValidTotpCode(config.secret, code);
  const validBackup = !validTotp && (await isValidBackupCode(config, code));
  if (!validTotp && !validBackup) {
    throw new AppError('Invalid verification code', 401, 'MFA_CODE_INVALID');
  }
  config.lastUsedAt = new Date();
  await config.save();
  return true;
}

export async function disableMfa(userId, { password }) {
  if (!password) throw new AppError('Password confirmation required', 400, 'MISSING_PASSWORD');

  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new AppError('Invalid password', 401, 'WRONG_PASSWORD');

  await MFAConfiguration.findOneAndDelete({ userId });
  await User.findByIdAndUpdate(userId, { mfaEnabled: false });

  return { message: 'MFA disabled successfully' };
}

export async function generateBackupCodes(userId) {
  const config = await MFAConfiguration.findOne({ userId });
  if (!config) throw new AppError('MFA not enrolled', 404, 'MFA_NOT_ENROLLED');

  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(4).toString('hex'));
  const hashedCodes = codes.map((c) => crypto.createHash('sha256').update(c).digest('hex'));

  config.backupCodes = hashedCodes;
  await config.save();

  return { codes };
}
