import { randomUUID } from "crypto";
import AdSyncJob from "../../models/application/AdSyncJob.js";

const ACTIVE_STATUSES = ["queued", "running"];

/**
 * @param {import('mongoose').Types.ObjectId | string} applicationId
 */
export async function findActiveAdSyncJobForApplication(applicationId) {
  return AdSyncJob.findOne({
    applicationId,
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * @param {{
 *   applicationId: import('mongoose').Types.ObjectId | string,
 *   syncConfig?: object,
 *   requestedBy?: import('mongoose').Types.ObjectId,
 * }} params
 */
export async function createAdSyncJob({ applicationId, syncConfig = {}, requestedBy }) {
  const jobId = randomUUID();
  const doc = await AdSyncJob.create({
    jobId,
    applicationId,
    status: "queued",
    phase: "queued",
    percent: 0,
    message: "Sync queued",
    syncConfig,
    requestedBy,
  });
  return doc.toObject ? doc.toObject() : doc;
}

/**
 * @param {string} jobId
 * @param {Record<string, unknown>} patch
 */
export async function patchAdSyncJob(jobId, patch) {
  return AdSyncJob.findOneAndUpdate(
    { jobId },
    { $set: patch },
    { new: true },
  ).lean();
}

/**
 * @param {string} jobId
 * @param {{ stage: string, ms: number, counts?: object, memoryMb?: number }} timing
 */
export async function appendAdSyncStageTiming(jobId, timing) {
  return AdSyncJob.findOneAndUpdate(
    { jobId },
    { $push: { stageTimings: timing } },
    { new: true },
  ).lean();
}

/**
 * @param {string} jobId
 * @param {string} applicationIdStr
 */
export async function getAdSyncJobForApplication(jobId, applicationIdStr) {
  const job = await AdSyncJob.findOne({ jobId }).lean();
  if (!job || String(job.applicationId) !== String(applicationIdStr)) {
    return null;
  }
  return job;
}
