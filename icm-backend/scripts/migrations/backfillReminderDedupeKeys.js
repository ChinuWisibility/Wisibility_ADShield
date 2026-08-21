/**
 * One-time backfill for the reminder reservation ledger.
 *
 * Assigns windowKey/dedupeKey to recent SENT CampaignReminderLog rows so they
 * participate in the new frequency-window dedupe, then ensures the unique sparse
 * index on `dedupeKey` exists.
 *
 * Historical duplicates (two SENT rows that fall in the same window — exactly the
 * bug this project fixes) are resolved by keying only the EARLIEST row in each
 * window and leaving the rest un-keyed, so the unique index can build cleanly.
 *
 * Usage: node scripts/migrations/backfillReminderDedupeKeys.js
 * Env:   REMINDER_DEDUPE_BACKFILL_DAYS (default 90)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import CampaignReminderLog from "../../src/models/certification/CampaignReminderLog.js";
import { resolveEffectiveFreqForCampaign } from "../../src/services/email/emailJobService.js";
import {
  computeReminderWindow,
  buildReminderDedupeKey,
} from "../../src/services/email/reminderWindow.js";

dotenv.config();

const LOOKBACK_DAYS = Number(process.env.REMINDER_DEDUPE_BACKFILL_DAYS || 90);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI");
  await mongoose.connect(uri);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const cursor = CampaignReminderLog.find({
    deliveryStatus: "SENT",
    sentAt: { $gte: since },
    $or: [{ dedupeKey: { $exists: false } }, { dedupeKey: null }],
  })
    .sort({ sentAt: 1 }) // earliest first — earliest wins the window
    .cursor();

  const freqCache = new Map();
  const claimed = new Set();
  let processed = 0;
  let assigned = 0;
  let duplicatesLeftUnkeyed = 0;

  for (let log = await cursor.next(); log != null; log = await cursor.next()) {
    processed++;
    if (!log.campaignId || !log.recipientEmail || !log.reminderType) continue;

    const campaignId = String(log.campaignId);
    let effFreq = freqCache.get(campaignId);
    if (effFreq === undefined) {
      effFreq =
        log.reminderType === "STANDARD"
          ? await resolveEffectiveFreqForCampaign(log.campaignId)
          : null;
      freqCache.set(campaignId, effFreq);
    }

    const win = computeReminderWindow({
      reminderType: log.reminderType,
      effectiveFreq: effFreq,
      at: log.sentAt,
    });
    const dedupeKey = buildReminderDedupeKey({
      campaignId: log.campaignId,
      recipientEmail: log.recipientEmail,
      reminderType: log.reminderType,
      windowKey: win.windowKey,
    });

    if (claimed.has(dedupeKey)) {
      duplicatesLeftUnkeyed++;
      continue;
    }
    const exists = await CampaignReminderLog.findOne({ dedupeKey })
      .select("_id")
      .lean();
    if (exists) {
      claimed.add(dedupeKey);
      duplicatesLeftUnkeyed++;
      continue;
    }

    await CampaignReminderLog.updateOne(
      { _id: log._id },
      { $set: { windowKey: win.windowKey, dedupeKey } },
    );
    claimed.add(dedupeKey);
    assigned++;
  }

  console.log(
    `[backfillReminderDedupeKeys] processed=${processed} assigned=${assigned} historicalDuplicatesLeftUnkeyed=${duplicatesLeftUnkeyed}`,
  );

  // Build the unique sparse index (safe: un-keyed rows are ignored by sparse).
  await CampaignReminderLog.syncIndexes();
  console.log("[backfillReminderDedupeKeys] indexes synced");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
