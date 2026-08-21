import { getDynamicUserModelForTenantId } from '../models/application/Users.js';
import { applicationIdInClause } from './applicationUserIngestService.js';
import { ingestApplicationUsersWithReconciliation } from './reconciliation/ingestWithReconciliation.js';

/**
 * Resolve a CSV cell when the saved `csvColumn` may not exactly match Papa row keys
 * (casing, stray spaces, legacy BOM quirks). Returns undefined when absent or blank.
 */
export function getMappedCell(row, csvColumn) {
  const wanted = String(csvColumn || "").trim();
  if (!wanted || row == null || typeof row !== "object") return undefined;

  if (Object.prototype.hasOwnProperty.call(row, wanted)) {
    const direct = row[wanted];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") return direct;
  }

  const wantedLower = wanted.toLowerCase();
  for (const key of Object.keys(row)) {
    const k = String(key || "").trim();
    if (!k) continue;
    if (k === wanted || k.toLowerCase() === wantedLower) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

/**
 * Whether a row should be stored as an application user document (Schema Management blueprint).
 * Prefer explicit primary key mapping; otherwise require legacy `user_id` (matches CSV upload behavior).
 */
export function shouldIncludeApplicationUserDoc(doc, mappings) {
  const pk = (mappings || []).find((m) => m.isPrimaryKey);
  if (pk) {
    const v = doc[pk.standardField];
    return v != null && String(v).trim() !== '';
  }
  return Boolean(doc.user_id);
}

/**
 * Map CSV rows to dynamic user documents using Application.userMappings (csvColumn → standardField).
 */
export function buildUserDocsFromMappedRows(rows, mappings, applicationId) {
  const { documents } = buildUserDocsFromMappedRowsWithStats(
    rows,
    mappings,
    applicationId,
  );
  return documents;
}

/**
 * Same as buildUserDocsFromMappedRows but counts CSV rows excluded for blank/missing primary key.
 * Builds a case-insensitive column index once so getMappedCell does not scan every row key per mapping.
 */
export function buildUserDocsFromMappedRowsWithStats(rows, mappings, applicationId) {
  const documents = [];
  let skippedMissingPk = 0;
  const mappingList = mappings || [];

  for (const row of rows || []) {
    const keyIndex = Object.create(null);
    for (const key of Object.keys(row || {})) {
      const k = String(key || "").trim();
      if (!k) continue;
      keyIndex[k] = key;
      keyIndex[k.toLowerCase()] = key;
    }

    const doc = { applicationId, rawData: row };
    for (const map of mappingList) {
      const wanted = String(map.csvColumn || "").trim();
      if (!wanted) continue;
      const resolvedKey = keyIndex[wanted] || keyIndex[wanted.toLowerCase()];
      if (!resolvedKey) continue;
      const csvValue = row[resolvedKey];
      if (csvValue !== undefined && csvValue !== null && String(csvValue).trim() !== "") {
        doc[map.standardField] = Array.isArray(csvValue) ? csvValue.join("; ") : csvValue;
      }
    }
    if (shouldIncludeApplicationUserDoc(doc, mappingList)) documents.push(doc);
    else skippedMissingPk += 1;
  }
  return { documents, skippedMissingPk };
}

/**
 * Whether a row should be stored as an entitlement document (Schema tab blueprint).
 * Prefer explicit primary key mapping; otherwise require legacy `entitlement_id` (matches older CSV uploads).
 */
export function shouldIncludeEntitlementDoc(doc, mappings) {
  const pk = (mappings || []).find((m) => m.isPrimaryKey);
  if (pk) {
    const v = doc[pk.standardField];
    return v != null && String(v).trim() !== "";
  }
  return Boolean(doc.entitlement_id);
}

/**
 * Map CSV rows to dynamic entitlement documents using Application.entitlementMappings (csvColumn → standardField).
 */
export function buildEntitlementDocsFromMappedRows(rows, mappings, applicationId) {
  const documentsToInsert = [];
  for (const row of rows) {
    const doc = { applicationId, rawData: row };
    for (const map of mappings || []) {
      const csvValue = getMappedCell(row, map.csvColumn);
      if (csvValue !== undefined && csvValue !== "") {
        doc[map.standardField] = Array.isArray(csvValue) ? csvValue.join("; ") : csvValue;
      }
    }
    if (shouldIncludeEntitlementDoc(doc, mappings)) documentsToInsert.push(doc);
  }
  return documentsToInsert;
}

/**
 * HRMS delimited apps: CSV is stored on `hrms.delimitedImportRows` (App Registry) or root `delimitedImportRows` (legacy).
 * Do not match generic catalog apps that only have `connectorType` delimited but no HRMS upload — avoids wiping their user store.
 */
export function isDelimitedFileHrmsApplication(application) {
  if (!application) return false;
  const h = application.hrms || {};
  if (h.connector === 'delimited_file') return true;
  if (application.connector === 'delimited_file') return true;
  if (Array.isArray(h.delimitedImportRows) && h.delimitedImportRows.length > 0) return true;
  if (Array.isArray(application.delimitedImportRows) && application.delimitedImportRows.length > 0) {
    return true;
  }
  return false;
}

function getDelimitedImportRows(application) {
  const h = application.hrms || {};
  if (Array.isArray(h.delimitedImportRows) && h.delimitedImportRows.length) {
    return h.delimitedImportRows;
  }
  if (Array.isArray(application.delimitedImportRows) && application.delimitedImportRows.length) {
    return application.delimitedImportRows;
  }
  return [];
}

/**
 * Writes HRMS delimited CSV rows into the app's dynamic Users collection (same shape as Upload Data CSV).
 * @returns {Promise<{ liveRows: number, summary: object }>}
 */
export async function materializeDelimitedImportToApplicationUsers(application) {
  const name = application.name;
  const mappings = application.userMappings || [];
  const rows = getDelimitedImportRows(application);

  if (!rows.length || !mappings.length) {
    // Never wipe live users when stored CSV rows are missing — Map & Import may
    // have already populated app_iga_*_users. Ask the client to upload a CSV instead.
    const UsersModel = await getDynamicUserModelForTenantId(name, application.tenantId);
    const appClause = applicationIdInClause(application._id);
    const liveRows = await UsersModel.countDocuments({ applicationId: appClause });
    return {
      liveRows,
      summary: {
        primaryKeyField: null,
        liveRows,
        duplicateGroups: 0,
        duplicateRows: 0,
        skippedMissingPk: 0,
        canonicalization: "first_row_wins",
        needsCsvUpload: true,
      },
      needsCsvUpload: true,
    };
  }

  const { documents, skippedMissingPk } = buildUserDocsFromMappedRowsWithStats(
    rows,
    mappings,
    application._id,
  );
  const { summary } = await ingestApplicationUsersWithReconciliation(application, documents, {
    source: "delimited_hrms",
    initialSkippedMissingPk: skippedMissingPk,
  });
  return { liveRows: summary.liveRows, summary };
}

/**
 * Apply the application's configured csvImportMapping to a set of raw rows (CSV or connector).
 * Returns the mapped document array ready for replaceApplicationUserIngest.
 * If no mapping is configured, returns null to indicate fallback to default logic.
 */
export function applyCsvImportMappingToRows(rawRows, application) {
  const cfg = application.csvImportMapping;
  const mappings = cfg?.mappings || [];
  if (!mappings.length) return null;

  const displayMode = String(cfg.displayNameMode || "direct").toLowerCase();
  const firstColCfg = String(cfg.displayNameFirstColumn || "").trim();
  const lastColCfg = String(cfg.displayNameLastColumn || "").trim();
  const fbFirst = String(cfg.displayNameFallbackFirstColumn || "").trim();
  const fbLast = String(cfg.displayNameFallbackLastColumn || "").trim();

  const built = buildUserDocsFromMappedRowsWithStats(
    rawRows || [],
    mappings,
    application._id,
  );

  let documentsToInsert = built.documents.map((doc) => {
    const raw = doc.rawData || {};
    let displayName =
      doc.display_name != null && String(doc.display_name).trim() !== ""
        ? String(doc.display_name).trim()
        : "";

    if (displayMode === "first_last") {
      const firstV = getMappedCell(raw, firstColCfg);
      const lastV = getMappedCell(raw, lastColCfg);
      const first = firstV != null ? String(firstV).trim() : "";
      const last = lastV != null ? String(lastV).trim() : "";
      displayName = `${first} ${last}`.trim();
    } else if (!displayName && fbFirst && fbLast) {
      const firstV = getMappedCell(raw, fbFirst);
      const lastV = getMappedCell(raw, fbLast);
      const first = firstV != null ? String(firstV).trim() : "";
      const last = lastV != null ? String(lastV).trim() : "";
      displayName = `${first} ${last}`.trim();
    }

    return { ...doc, display_name: displayName };
  });

  // The Users model schema strictly requires member_of_entitlements to be a String.
  // We leave it as a delimited string here; subsequent processing (like aggregations or CSV uploads) 
  // will parse it when needed, but the database expects a String.

  return { documentsToInsert, skippedMissingPk: built.skippedMissingPk };
}
