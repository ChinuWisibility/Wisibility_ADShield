import crypto from 'node:crypto';
import env from '../config/env.js';

function getKey() {
  // Prefer explicit key, fallback to JWT secret (development convenience).
  const k = process.env.CONNECTION_ENCRYPTION_KEY || env.jwt.secret;
  if (!k) throw new Error('Missing CONNECTION_ENCRYPTION_KEY (or JWT_SECRET) for encryption');
  // Derive 32-byte key from string.
  return crypto.createHash('sha256').update(String(k)).digest();
}

export function encryptString(plainText) {
  if (plainText === undefined || plainText === null || plainText === '') return '';
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptString(enc) {
  if (!enc) return '';
  const [ivB64, tagB64, dataB64] = String(enc).split('.');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString('utf8');
}

