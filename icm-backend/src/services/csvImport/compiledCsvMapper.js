/**
 * Compile CSV import mapping once; O(1) field lookup per row.
 * Used only by Map & import (`uploadApplicationUsersCsvMapped`).
 */

/**
 * @typedef {object} CompiledCsvMapper
 * @property {string} pkField
 * @property {string} entitlementsListAttr
 * @property {string} displayMode
 * @property {(row: object) => { doc: object|null, skippedMissingPk: boolean }} mapRow
 */

/**
 * @param {object[]} mappings csvImportMapping.mappings
 * @param {string[]} fields CSV headers
 * @param {object} [cfgPlain] csvImportMapping plain object
 * @returns {CompiledCsvMapper}
 */
export function compileCsvMapper(mappings, fields, cfgPlain = {}) {
  const mappingList = Array.isArray(mappings) ? mappings : [];
  const headerIndex = Object.create(null);
  for (const h of fields || []) {
    const k = String(h || "").trim();
    if (!k) continue;
    headerIndex[k] = k;
    headerIndex[k.toLowerCase()] = k;
  }

  /** @type {{ standardField: string, resolvedHeader: string|null }[]} */
  const compiledMaps = [];
  let pkField = "";
  for (const map of mappingList) {
    const standardField = String(map.standardField || "").trim();
    if (!standardField) continue;
    const wanted = String(map.csvColumn || "").trim();
    const resolvedHeader = wanted
      ? headerIndex[wanted] || headerIndex[wanted.toLowerCase()] || null
      : null;
    compiledMaps.push({ standardField, resolvedHeader });
    if (map.isPrimaryKey) pkField = standardField;
  }
  if (!pkField) {
    const pk = mappingList.find((m) => m.isPrimaryKey);
    pkField = String(pk?.standardField || "").trim();
  }

  const displayMode =
    String(cfgPlain.displayNameMode || "direct").toLowerCase() === "first_last"
      ? "first_last"
      : "direct";
  const firstCol = String(cfgPlain.displayNameFirstColumn || "").trim();
  const lastCol = String(cfgPlain.displayNameLastColumn || "").trim();
  const fbFirst = String(cfgPlain.displayNameFallbackFirstColumn || "").trim();
  const fbLast = String(cfgPlain.displayNameFallbackLastColumn || "").trim();
  const firstHeader = firstCol
    ? headerIndex[firstCol] || headerIndex[firstCol.toLowerCase()] || null
    : null;
  const lastHeader = lastCol
    ? headerIndex[lastCol] || headerIndex[lastCol.toLowerCase()] || null
    : null;
  const fbFirstHeader = fbFirst
    ? headerIndex[fbFirst] || headerIndex[fbFirst.toLowerCase()] || null
    : null;
  const fbLastHeader = fbLast
    ? headerIndex[fbLast] || headerIndex[fbLast.toLowerCase()] || null
    : null;

  const entitlementsListAttr =
    String(cfgPlain.entitlementsStandardField || "").trim() ||
    "member_of_entitlements";

  function cell(row, headerKey) {
    if (!headerKey || !row) return undefined;
    const v = row[headerKey];
    if (v === undefined || v === null || String(v).trim() === "") return undefined;
    return v;
  }

  function mapRow(row) {
    const doc = { rawData: row };
    for (const m of compiledMaps) {
      if (!m.resolvedHeader) continue;
      const csvValue = cell(row, m.resolvedHeader);
      if (csvValue === undefined) continue;
      doc[m.standardField] = Array.isArray(csvValue)
        ? csvValue.join("; ")
        : csvValue;
    }

    if (pkField) {
      const pkVal = doc[pkField];
      if (pkVal == null || String(pkVal).trim() === "") {
        return { doc: null, skippedMissingPk: true };
      }
    } else if (!doc.user_id) {
      return { doc: null, skippedMissingPk: true };
    }

    let displayName =
      doc.display_name != null && String(doc.display_name).trim() !== ""
        ? String(doc.display_name).trim()
        : "";
    if (displayMode === "first_last" && firstHeader && lastHeader) {
      const first = String(cell(row, firstHeader) ?? "").trim();
      const last = String(cell(row, lastHeader) ?? "").trim();
      displayName = `${first} ${last}`.trim();
    } else if (!displayName && fbFirstHeader && fbLastHeader) {
      const first = String(cell(row, fbFirstHeader) ?? "").trim();
      const last = String(cell(row, fbLastHeader) ?? "").trim();
      displayName = `${first} ${last}`.trim();
    }
    doc.display_name = displayName;

    if (Object.prototype.hasOwnProperty.call(doc, entitlementsListAttr)) {
      const raw =
        doc.rawData && typeof doc.rawData === "object" ? { ...doc.rawData } : {};
      if (raw[entitlementsListAttr] == null) {
        raw[entitlementsListAttr] = doc[entitlementsListAttr];
      }
      delete doc[entitlementsListAttr];
      doc.rawData = raw;
    }

    return { doc, skippedMissingPk: false };
  }

  return {
    pkField,
    entitlementsListAttr,
    displayMode,
    mapRow,
  };
}
