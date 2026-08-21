import mongoose from "mongoose";

/**
 * Strict ObjectId parser — avoids BSONError from ObjectId.isValid() false positives.
 */
export function safeAsObjectId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!/^[a-fA-F0-9]{24}$/.test(s)) return null;
  try {
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
}

export function safeAsObjectIdString(value) {
  const oid = safeAsObjectId(value);
  return oid ? String(oid) : null;
}
