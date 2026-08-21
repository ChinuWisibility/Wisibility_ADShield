import { parseCsvBufferStreaming } from "../../utils/csvUploadPerformance.js";
import { validateMappedUserCsvHeaders } from "../../utils/applicationMappingValidation.js";
import { compileCsvMapper } from "./compiledCsvMapper.js";

/**
 * High-performance Map & import CSV engine (parse → validate → transform once).
 * Does not touch AD / connector builders.
 */

/**
 * @param {Buffer} buffer
 * @param {object} application
 * @param {{ originalname?: string }} [fileMeta]
 */
export async function runCsvImportEngine(buffer, application, fileMeta = {}) {
  const stageTimings = {};
  let t = Date.now();
  const mark = (name) => {
    stageTimings[name] = Date.now() - t;
    t = Date.now();
  };

  const cfg = application.csvImportMapping;
  const mappings = cfg?.mappings || [];
  if (!mappings.length) {
    throw new Error(
      "No CSV import mapping saved. Complete Map & import and save the mapping first.",
    );
  }

  const cfgPlain =
    cfg && typeof cfg.toObject === "function" ? cfg.toObject() : { ...(cfg || {}) };

  const { rows, fields } = await parseCsvBufferStreaming(buffer);
  mark("parseMs");

  const headerCheck = validateMappedUserCsvHeaders(mappings, fields, cfgPlain);
  if (!headerCheck.ok) {
    const err = new Error(headerCheck.message);
    err.statusCode = 400;
    err.details = { missing: headerCheck.missing, extra: headerCheck.extra };
    throw err;
  }

  const displayMode = String(cfgPlain.displayNameMode || "direct").toLowerCase();
  const firstColCfg = String(cfgPlain.displayNameFirstColumn || "").trim();
  const lastColCfg = String(cfgPlain.displayNameLastColumn || "").trim();
  if (displayMode === "first_last" && (!firstColCfg || !lastColCfg)) {
    const err = new Error(
      "Import mapping is incomplete: first/last name columns required for display name mode.",
    );
    err.statusCode = 400;
    throw err;
  }
  mark("validateMs");

  const mapper = compileCsvMapper(mappings, fields, cfgPlain);
  const documents = [];
  let skippedMissingPk = 0;
  for (const row of rows) {
    const hasValue = Object.values(row || {}).some(
      (v) => v != null && String(v).trim() !== "",
    );
    if (!hasValue) continue;
    const { doc, skippedMissingPk: skip } = mapper.mapRow(row);
    if (skip || !doc) {
      skippedMissingPk += 1;
      continue;
    }
    doc.applicationId = application._id;
    documents.push(doc);
  }
  mark("transformMs");

  return {
    fields,
    mappings,
    cfgPlain,
    documents,
    skippedMissingPk,
    uploadedFileName: fileMeta.originalname || null,
    engineTimings: stageTimings,
  };
}
