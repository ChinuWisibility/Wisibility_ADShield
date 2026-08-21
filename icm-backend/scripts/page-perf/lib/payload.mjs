import { bytesOf, fieldContributions, projectRows } from "./bytes.mjs";

/** Common list fields used when estimating a thin projection. */
export const DEFAULT_LIST_FIELDS = [
  "_id",
  "tenantId",
  "displayName",
  "email",
  "employeeId",
  "firstname",
  "lastname",
  "firstName",
  "lastName",
  "department",
  "title",
  "lifecycleState",
  "isActive",
  "status",
  "managerId",
  "updatedAt",
  "createdAt",
];

/**
 * Analyze payload efficiency for a page of rows.
 */
export function analyzePayload(rows, { listFields = DEFAULT_LIST_FIELDS, apiBytes = null } = {}) {
  const rawBytes = bytesOf(rows);
  const topFields = fieldContributions(Array.isArray(rows) ? rows : []);
  const projected = projectRows(Array.isArray(rows) ? rows : [], listFields);
  const projectedBytes = bytesOf(projected);
  const baseline = apiBytes ?? rawBytes;
  const potentialSavingsPct =
    baseline > 0 ? Math.round(((baseline - Math.min(baseline, projectedBytes)) / baseline) * 1000) / 10 : 0;

  const heavyObjects = topFields
    .filter((f) => f.bytes >= Math.max(500, baseline * 0.08))
    .map((f) => f.field);

  return {
    rawBytes,
    apiBytes: apiBytes ?? null,
    projectedBytes,
    topFields,
    heavyObjects,
    potentialSavingsPct,
    bytesPerRow: Array.isArray(rows) && rows.length ? Math.round(rawBytes / rows.length) : null,
  };
}

/** Rough client parse cost: ~0.02 ms per KB JSON (heuristic, not browser measured). */
export function estimateParseMs(payloadBytes) {
  if (payloadBytes == null) return null;
  return Math.round((payloadBytes / 1024) * 0.02 * 100) / 100;
}

/** Rough render cost: ~0.15 ms per row for a simple table (heuristic). */
export function estimateRenderMs(rows) {
  if (rows == null) return null;
  return Math.round(rows * 0.15 * 100) / 100;
}
