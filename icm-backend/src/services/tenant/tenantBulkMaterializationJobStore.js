/**
 * In-process tenant bulk identity materialization jobs (single Node process).
 * POST /materialization/bulk-refresh returns 202 + jobId; client polls GET …/jobs/:jobId.
 * For multi-instance deployments, replace with Redis or a persistent queue.
 */

import { randomUUID } from "crypto";

const JOB_TTL_MS = Number(process.env.TENANT_BULK_MAT_JOB_TTL_MS ?? 7200000);
const MAX_JOBS = Number(process.env.TENANT_BULK_MAT_JOB_STORE_MAX ?? 200);

/** @typedef {'queued' | 'running' | 'completed' | 'failed'} BulkMatJobStatus */

/**
 * @typedef {object} TenantBulkMaterializationJob
 * @property {string} jobId
 * @property {string} tenantId
 * @property {BulkMatJobStatus} status
 * @property {string} [phase]
 * @property {number} [percent]
 * @property {string} [message]
 * @property {object} [result]
 * @property {string} [error]
 * @property {number} createdAt
 * @property {number} [startedAt]
 * @property {number} [completedAt]
 */

/** @type {Map<string, TenantBulkMaterializationJob>} */
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
 * @param {string} tenantIdStr
 */
export function createTenantBulkMaterializationJob(tenantIdStr) {
  pruneOld();
  const jobId = randomUUID();
  /** @type {TenantBulkMaterializationJob} */
  const job = {
    jobId,
    tenantId: String(tenantIdStr),
    status: "queued",
    phase: "queued",
    percent: 0,
    message: "Queued on server…",
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);
  return jobId;
}

/**
 * @param {string} jobId
 * @param {Partial<TenantBulkMaterializationJob>} patch
 */
export function patchTenantBulkMaterializationJob(jobId, patch) {
  const j = jobs.get(jobId);
  if (!j) return null;
  Object.assign(j, patch);
  return j;
}

/**
 * @param {string} jobId
 * @returns {TenantBulkMaterializationJob | null}
 */
export function getTenantBulkMaterializationJob(jobId) {
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
 * @param {string} tenantIdStr
 */
export function getTenantBulkMaterializationJobForTenant(jobId, tenantIdStr) {
  const j = getTenantBulkMaterializationJob(jobId);
  if (!j || String(j.tenantId) !== String(tenantIdStr)) return null;
  return j;
}
