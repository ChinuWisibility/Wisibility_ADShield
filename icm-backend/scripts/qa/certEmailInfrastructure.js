/**
 * Track B QA helpers — run with: node scripts/qa/certEmailInfrastructure.js <test>
 *
 * Tests: audit | jwt | enqueue | crash-recovery | volume
 *
 * Requires MONGODB_URI (or app DB connection) for DB-backed tests.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import EmailJob from "../../src/models/email/EmailJob.js";
import EmailDeliveryLog from "../../src/models/email/EmailDeliveryLog.js";
import { enqueueCertificationEmail } from "../../src/services/email/emailJobService.js";
import {
  recoverStaleProcessingJobs,
  runEmailWorkerOnce,
} from "../../src/services/email/emailWorkerService.js";
import { validateReviewerToken } from "../../src/services/email/jwtPortalLinkService.js";

dotenv.config();

const TEST = process.argv[2] || "audit";

async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI to run QA scripts");
  await mongoose.connect(uri);
}

async function testAuditCompleteness() {
  const sentJobs = await EmailJob.find({ status: "SENT" }).limit(500).lean();
  let missing = 0;
  for (const job of sentJobs) {
    const log = await EmailDeliveryLog.findOne({ emailJobId: job._id }).lean();
    if (!log) missing++;
  }
  console.log(`[B29] SENT jobs checked: ${sentJobs.length}, missing delivery log: ${missing}`);
  return missing === 0;
}

async function testJwtValidity() {
  const secret =
    process.env.JWT_SECRET ||
    process.env.CERTIFICATION_JWT_SECRET ||
    "certification-reviewer-secret";
  const campaignId = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign(
    {
      typ: "cert_reviewer",
      reviewerEmail: "qa.reviewer@example.com",
      campaignId,
    },
    secret,
    { expiresIn: "1h" },
  );
  const valid = validateReviewerToken(token);
  const expired = jwt.sign(
    { typ: "cert_reviewer", reviewerEmail: "qa@example.com", campaignId },
    secret,
    { expiresIn: "-1s" },
  );
  let expiredRejected = false;
  try {
    validateReviewerToken(expired);
  } catch {
    expiredRejected = true;
  }
  console.log("[B27] Valid token accepted:", Boolean(valid?.reviewerEmail));
  console.log("[B27] Expired token rejected:", expiredRejected);
  return Boolean(valid?.reviewerEmail) && expiredRejected;
}

async function testEnqueue() {
  const campaignId = new mongoose.Types.ObjectId();
  const job = await enqueueCertificationEmail({
    type: "REMINDER",
    campaignId,
    recipientEmail: "qa.test@example.com",
    subject: "[QA] Reminder test",
    html: "<p>QA enqueue test</p>",
    reminderSubtype: "WEEKLY",
  });
  const found = await EmailJob.findById(job._id).lean();
  console.log("[B26] Job enqueued:", found?.status === "PENDING");
  await EmailJob.deleteOne({ _id: job._id });
  return found?.status === "PENDING";
}

async function testCrashRecovery() {
  const campaignId = new mongoose.Types.ObjectId();
  const stale = await EmailJob.create({
    type: "REMINDER",
    campaignId,
    recipientEmail: "crash.test@example.com",
    subject: "crash",
    html: "<p>crash</p>",
    status: "PROCESSING",
    processingStartedAt: new Date(Date.now() - 20 * 60 * 1000),
  });
  await recoverStaleProcessingJobs();
  const recovered = await EmailJob.findById(stale._id).lean();
  console.log("[B28] Stale job recovered to PENDING:", recovered?.status === "PENDING");
  await EmailJob.deleteOne({ _id: stale._id });
  return recovered?.status === "PENDING";
}

async function testVolumeEnqueue() {
  const campaignId = new mongoose.Types.ObjectId();
  const count = Number(process.env.QA_VOLUME_COUNT || 500);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const job = await enqueueCertificationEmail({
      type: "REMINDER",
      campaignId,
      recipientEmail: `qa.volume${i}@example.com`,
      subject: `[QA] Volume ${i}`,
      html: `<p>Volume test ${i}</p>`,
      reminderSubtype: "WEEKLY",
    });
    ids.push(job._id);
  }
  console.log(`[B24] Enqueued ${ids.length} jobs`);
  await EmailJob.deleteMany({ _id: { $in: ids } });
  return ids.length >= 500;
}

async function main() {
  await connectDb();
  let ok = false;
  switch (TEST) {
    case "audit":
      ok = await testAuditCompleteness();
      break;
    case "jwt":
      ok = await testJwtValidity();
      break;
    case "enqueue":
      ok = await testEnqueue();
      break;
    case "crash-recovery":
      ok = await testCrashRecovery();
      break;
    case "volume":
      ok = await testVolumeEnqueue();
      break;
    default:
      console.error("Unknown test:", TEST);
      process.exit(1);
  }
  await mongoose.disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
