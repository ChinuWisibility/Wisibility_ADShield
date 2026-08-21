/**
 * One-time migration: CertificationEscalation documents created before the schema
 * was updated store originalReviewerId / escalatedToId as plain strings (User ID strings).
 * This migration attempts to resolve each to an ObjectId by looking up the User table.
 * Best-effort: documents where no matching User is found are left untouched.
 */

import mongoose from "mongoose";
import CertificationEscalation from "../src/models/certification/CertificationEscalation.js";
import User from "../src/models/platform/User.js";

const BATCH_SIZE = 500;

async function resolveIdField(rawValue) {
  if (!rawValue) return null;
  const str = String(rawValue);
  if (mongoose.Types.ObjectId.isValid(str) && str.length === 24) {
    return new mongoose.Types.ObjectId(str);
  }
  return null;
}

export default async function migrateEscalationIds() {
  let processed = 0;
  let updated = 0;
  let skip = 0;

  while (true) {
    // Find escalations where either ID field is still a string (not an ObjectId).
    // After the schema change mongoose will cast ObjectId strings automatically,
    // so we look for documents where the field value cannot be cast — i.e. email-style strings or legacy IDs.
    const batch = await CertificationEscalation.find({})
      .skip(skip)
      .limit(BATCH_SIZE)
      .lean();

    if (!batch.length) break;

    const ops = [];

    for (const doc of batch) {
      const $set = {};

      // Attempt to resolve originalReviewerId if it looks like a string ID.
      if (doc.originalReviewerId && typeof doc.originalReviewerId === "string") {
        const oid = await resolveIdField(doc.originalReviewerId);
        if (oid) $set.originalReviewerId = oid;
      }

      // Attempt to resolve escalatedToId similarly.
      if (doc.escalatedToId && typeof doc.escalatedToId === "string") {
        const oid = await resolveIdField(doc.escalatedToId);
        if (oid) $set.escalatedToId = oid;
      }

      // Backfill email fields if missing and we have the ID.
      if (!doc.originalReviewerEmail && doc.originalReviewerId) {
        const uid = $set.originalReviewerId || doc.originalReviewerId;
        if (mongoose.Types.ObjectId.isValid(String(uid))) {
          const u = await User.findById(uid).select("email").lean();
          if (u?.email) $set.originalReviewerEmail = String(u.email).toLowerCase();
        }
      }

      if (!doc.escalatedToEmail && doc.escalatedToId) {
        const uid = $set.escalatedToId || doc.escalatedToId;
        if (mongoose.Types.ObjectId.isValid(String(uid))) {
          const u = await User.findById(uid).select("email").lean();
          if (u?.email) $set.escalatedToEmail = String(u.email).toLowerCase();
        }
      }

      if (Object.keys($set).length > 0) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set },
          },
        });
      }
    }

    if (ops.length > 0) {
      const result = await CertificationEscalation.bulkWrite(ops, {
        ordered: false,
      });
      updated += result.modifiedCount ?? result.nModified ?? 0;
    }

    processed += batch.length;
    skip += BATCH_SIZE;

    if (batch.length < BATCH_SIZE) break;
  }

  console.log(
    `[011_escalationIdFix] processed=${processed}, updated=${updated}`,
  );
}
