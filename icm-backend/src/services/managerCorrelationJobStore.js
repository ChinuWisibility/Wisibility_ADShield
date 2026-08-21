/**
 * In-process manager correlation jobs (single Node process).
 * For multi-instance deployments, replace with Redis or a persistent queue.
 */

import { randomUUID } from "crypto";

/** @type {number} */
const JOB_TTL_MS = Number(process.env.MANAGER_CORR_JOB_TTL_MS ?? 3600000);
/** @type {number} */
const MAX_JOBS = Number(process.env.MANAGER_CORR_JOB_STORE_MAX ?? 500);

/** @typedef {'queued' | 'running' | 'completed' | 'failed'} JobStatus */

/**
 * @typedef {object} ManagerCorrelationJob
 * @property {string} jobId
 * @property {string} applicationId
 * @property {JobStatus} status
 * @property {string} [phase]
 * @property {number} [percent] 0–100
 * @property {string} [message]
 * @property {object} [result]
 * @property {string} [error]
 * @property {number} createdAt
 * @property {number} [startedAt]
 * @property {number} [completedAt]
 */

/** @type {Map<string, ManagerCorrelationJob>} */
const jobs = new Map();

function pruneOld() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size > MAX_JOBS) {
    const first = jobs.keys().next().value;
    if (first) jobs.delete(first);
    else break;
  }
}

/**
 * @param {string} applicationIdStr
 * @returns {string}
 */
export function createManagerCorrelationJob(applicationIdStr) {
  pruneOld();
  const jobId = randomUUID();
  /** @type {ManagerCorrelationJob} */
  const job = {
    jobId,
    applicationId: applicationIdStr,
    status: "queued",
    phase: "queued",
    percent: 0,
    message: "Queued…",
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);
  return jobId;
}

/**
 * @param {string} jobId
 * @param {Partial<ManagerCorrelationJob>} patch
 */
export function patchManagerCorrelationJob(jobId, patch) {
  const j = jobs.get(jobId);
  if (!j) return null;
  Object.assign(j, patch);
  return j;
}

/**
 * @param {string} jobId
 * @returns {ManagerCorrelationJob | null}
 */
export function getManagerCorrelationJob(jobId) {
  const j = jobs.get(jobId);
  if (!j) return null;
  if (Date.now() - j.createdAt > JOB_TTL_MS) {
    jobs.delete(jobId);
    return null;
  }
  return { ...j };
}

/**
 * @param {string} jobId
 * @param {string} applicationIdStr
 * @returns {ManagerCorrelationJob | null}
 */
export function getManagerCorrelationJobForApplication(jobId, applicationIdStr) {
  const j = getManagerCorrelationJob(jobId);
  if (!j || String(j.applicationId) !== String(applicationIdStr)) return null;
  return j;
}
