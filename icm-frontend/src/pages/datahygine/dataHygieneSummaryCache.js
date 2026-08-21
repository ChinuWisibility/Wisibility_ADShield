/** Bump when summary shape changes (e.g. new widgets) so sessionStorage does not hide new tiles. */
const STORAGE_PREFIX = 'icm:dataHygieneSummary:v14:';

function storageKey(tenantId) {
  const id = tenantId == null || tenantId === '' ? '__none__' : String(tenantId);
  return `${STORAGE_PREFIX}${id}`;
}

/**
 * Read cached summary for this browser tab (sessionStorage).
 * @param {string | null} tenantId
 * @returns {object | null}
 */
export function readDataHygieneSummaryCache(tenantId) {
  try {
    const raw = sessionStorage.getItem(storageKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.summary == null) return null;
    return parsed.summary;
  } catch {
    return null;
  }
}

/**
 * @param {string | null} tenantId
 * @param {object} summary
 */
export function writeDataHygieneSummaryCache(tenantId, summary) {
  try {
    sessionStorage.setItem(
      storageKey(tenantId),
      JSON.stringify({ summary, cachedAt: Date.now() }),
    );
  } catch {
    // Quota / private mode — ignore
  }
}

/**
 * @param {string | null} tenantId
 */
export function clearDataHygieneSummaryCache(tenantId) {
  try {
    sessionStorage.removeItem(storageKey(tenantId));
  } catch {
    /* ignore */
  }
}
