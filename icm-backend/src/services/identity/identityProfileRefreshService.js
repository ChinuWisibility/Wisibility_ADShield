import mongoose from "mongoose";
import { randomUUID } from "crypto";
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
  mirrorIdentityBulkWriteToLegacy,
} from "../../models/identity/Identity.js";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import Application from "../../models/application/Application.js";
import { resolveHrmsIntegrationRecord } from "../../utils/hrmsConnectorResolve.js";
import {
  normalizeMappingsPayload,
  csvRowToIdentityPayload,
  csvRowToIdentityPayloadSync,
  csvRowToAccountFields,
  accountDocToCsvRow,
  validateCorrelationConfig,
  findIdentityMatchForUpsert,
  shouldSkipCorrelation,
  resolveManagersAfterRefresh,
  buildIdentityUpsertFilter,
  getCorrelationValueFromPayload,
  buildTransformCacheForMappings,
  canonicalIdentityMappingTargetKey,
  stripStaleManagerAttributeKeys,
  buildAccountUserRowForIdentityRefresh,
} from "../../utils/identityProfileMappingUtils.js";
import Transform from "../../models/governance/Transform.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { TRANSFORM_OPTIONS, isValidTargetKey } from "../../constants/identityProfileTargets.js";

export async function validateAttributeMappings(tenantId, mappings, options = {}) {
  const mappingSourceMode = options.mappingSourceMode || "delimited_csv";

  if (!Array.isArray(mappings)) {
    return "attributeMappings must be an array";
  }
  const seen = new Set();
  for (const m of mappings) {
    if (!m || typeof m !== "object") return "Invalid mapping row";
    if (!m.targetKey || !isValidTargetKey(String(m.targetKey).trim())) {
      return `Invalid target attribute key: ${m.targetKey}. Use letters, numbers, underscore, or dot (max 128 chars).`;
    }
    const tk = String(m.targetKey).trim();
    if (seen.has(tk)) return `Duplicate target attribute: ${tk}`;
    seen.add(tk);
    const appRef = m.applicationId || m.hrmsSourceId;
    if (!appRef || !mongoose.Types.ObjectId.isValid(String(appRef))) {
      return "Each mapping requires a valid applicationId (App Registry source application)";
    }
    const rec = await resolveHrmsIntegrationRecord(tenantId, appRef);
    if (!rec) return "Source application not found for this tenant";
    if (rec.isActive === false) return `Source "${rec.name}" is inactive`;
    if (m.customTransformId) {
      if (!mongoose.Types.ObjectId.isValid(String(m.customTransformId))) {
        return `Invalid Transform Studio reference on ${tk}`;
      }
      const tdoc = await Transform.findOne({ _id: m.customTransformId, tenantId }).lean();
      if (!tdoc) return `Transform Studio document not found for this tenant (${tk})`;
    } else {
      const tr = m.transform || "none";
      if (!TRANSFORM_OPTIONS.includes(tr)) return `Invalid transform: ${tr}`;
    }
    // NOTE: We no longer validate that sourceAttribute is in the schema blueprint.
    // The user configures schema management separately; this was silently blocking all upserts.
  }
  return null;
}

/** Chunk size for Mongo bulkWrite (balance round-trips vs BSON limits). */
const IDENTITY_REFRESH_BULK_CHUNK = 800;

function ensureDisplayNameFromCorrelation(payload, correlationTargetKey) {
  if (payload.displayName && String(payload.displayName).trim()) return;
  const parts = [payload.firstName, payload.lastName].filter(Boolean);
  if (parts.length) {
    payload.displayName = parts.join(" ").trim();
    return;
  }
  const key = canonicalIdentityMappingTargetKey(String(correlationTargetKey || "email").trim());
  let fallbackName = null;
  if (["email", "employeeId", "uid"].includes(key)) {
    if (key === "uid" && payload.attributes?.uid) fallbackName = payload.attributes.uid;
    else fallbackName = payload[key];
  } else if (payload.attributes?.[key]) {
    fallbackName = payload.attributes[key];
  }
  payload.displayName = fallbackName ? String(fallbackName).trim() : "Unknown User (Unmapped)";
}

function isTerminatedLifecycleState(state) {
  return ["TERMINATED", "LEAVER", "INACTIVE"].includes(String(state || "").toUpperCase());
}

function applyLifecycleDerivedIdentityFields(payload, setDoc, existing) {
  const life = String(payload.lifecycleState || setDoc.lifecycleState || "ACTIVE").toUpperCase();
  const terminated = isTerminatedLifecycleState(life);

  if (payload.isActive != null) {
    setDoc.isActive = Boolean(payload.isActive);
  } else {
    setDoc.isActive = !terminated;
  }

  if (payload.endDate != null && payload.endDate !== "") {
    setDoc.endDate = payload.endDate;
  } else if (terminated) {
    if (!existing?.endDate) setDoc.endDate = new Date();
  } else if (
    ["ACTIVE", "NEW", "REHIRE", "MOVER"].includes(life) &&
    existing?.endDate &&
    payload.endDate == null
  ) {
    // Reactivation / mover: clear stale termination date when HRMS no longer sends one
    setDoc.endDate = null;
  }
}

function buildSetDocFromPayload(profile, tenantId, payload, existing) {
  if (!payload.email && existing?.email && !String(existing.email).includes("@unmapped.local")) {
    payload.email = existing.email;
  }
  if (!String(payload.displayName || "").trim() && existing?.displayName) {
    payload.displayName = existing.displayName;
  }
  const prevAttrs =
    existing?.attributes && typeof existing.attributes === "object" ? { ...existing.attributes } : {};
  const incomingAttrs = payload.attributes && typeof payload.attributes === "object" ? payload.attributes : {};
  const mergedAttrs = Object.keys(incomingAttrs).length ? { ...prevAttrs, ...incomingAttrs } : prevAttrs;
  const cleanedAttrs = stripStaleManagerAttributeKeys(mergedAttrs, payload);

  const setDoc = {
    tenantId,
    displayName: String(payload.displayName).trim(),
    firstName: payload.firstName,
    lastName: payload.lastName,
    employeeId: payload.employeeId,
    department: payload.department,
    title: payload.title,
    phoneNumber: payload.phoneNumber,
    managerEmail: payload.managerEmail,
    managerEmployeeId: payload.managerEmployeeId,
    startDate: payload.startDate,
    lifecycleState: payload.lifecycleState || "ACTIVE",
    identityProfileId: profile._id,
    lastSyncedAt: new Date(),
    sourceApplication: profile.sourceApplicationId || undefined,
  };

  applyLifecycleDerivedIdentityFields(payload, setDoc, existing);

  if (payload.email && String(payload.email).trim()) {
    if (!String(payload.email).includes("@unmapped.local")) {
      setDoc.email = String(payload.email).toLowerCase().trim();
    }
  }

  Object.keys(setDoc).forEach((k) => {
    if (setDoc[k] === undefined) delete setDoc[k];
  });

  if (Object.keys(cleanedAttrs).length) {
    setDoc.attributes = cleanedAttrs;
  }
  return { setDoc };
}

function clonePayloadForSetDoc(payload) {
  return {
    ...payload,
    attributes: payload.attributes && typeof payload.attributes === "object" ? { ...payload.attributes } : undefined,
  };
}

/**
 * MongoDB 4.2+ aggregation pipeline update: same semantics as buildSetDocFromPayload + existing doc
 * (preserve non-synthetic email, merge attributes) without a prefetch query.
 */
function pipelinePreserveField(incoming) {
  const s = incoming != null ? String(incoming).trim() : "";
  if (s !== "") return incoming;
  return null;
}

function buildIdentityRefreshUpdatePipeline(profile, tenantId, payload) {
  const incomingAttrs =
    payload.attributes && typeof payload.attributes === "object" ? { ...payload.attributes } : {};
  const inc = String(payload.email || "").trim();
  const useIncoming = inc.length > 0 && !inc.includes("@unmapped.local");

  const emailExpr = useIncoming
    ? inc.toLowerCase()
    : {
        $cond: {
          if: {
            $and: [
              { $ne: [{ $ifNull: ["$email", ""] }, ""] },
              {
                $not: {
                  $regexMatch: {
                    input: { $ifNull: ["$email", ""] },
                    regex: "unmapped\\.local",
                    options: "i",
                  },
                },
              },
            ],
          },
          then: { $toLower: { $ifNull: ["$email", ""] } },
          else: "$email",
        },
      };

  const preserve = (incoming, field) => {
    const kept = pipelinePreserveField(incoming);
    return kept != null ? kept : `$${field}`;
  };

  const life = String(payload.lifecycleState || "ACTIVE").toUpperCase();
  const terminated = isTerminatedLifecycleState(life);
  const explicitIsActive = payload.isActive != null ? Boolean(payload.isActive) : null;
  const explicitEndDate =
    payload.endDate != null && payload.endDate !== "" ? payload.endDate : null;

  const setFields = {
    tenantId,
    displayName: preserve(payload.displayName, "displayName"),
    firstName: preserve(payload.firstName, "firstName"),
    lastName: preserve(payload.lastName, "lastName"),
    employeeId: preserve(payload.employeeId, "employeeId"),
    department: preserve(payload.department, "department"),
    title: preserve(payload.title, "title"),
    phoneNumber: preserve(payload.phoneNumber, "phoneNumber"),
    managerEmail: preserve(payload.managerEmail, "managerEmail"),
    managerEmployeeId: preserve(payload.managerEmployeeId, "managerEmployeeId"),
    startDate: preserve(payload.startDate, "startDate"),
    lifecycleState: payload.lifecycleState || "ACTIVE",
    identityProfileId: profile._id,
    lastSyncedAt: "$$NOW",
    sourceApplication: profile.sourceApplicationId || undefined,
    email: emailExpr,
    isActive: explicitIsActive != null ? explicitIsActive : !terminated,
    endDate:
      explicitEndDate != null
        ? explicitEndDate
        : terminated
          ? { $ifNull: ["$endDate", "$$NOW"] }
          : ["ACTIVE", "NEW", "REHIRE", "MOVER"].includes(life)
            ? null
            : "$endDate",
  };

  Object.keys(setFields).forEach((k) => {
    if (setFields[k] === undefined) delete setFields[k];
  });

  if (Object.keys(incomingAttrs).length > 0) {
    setFields.attributes = {
      $mergeObjects: [{ $ifNull: ["$attributes", {}] }, incomingAttrs],
    };
  }

  const stages = [{ $set: setFields }];
  if (String(payload.managerEmployeeId || "").trim()) {
    stages.push({
      $unset: [
        "attributes.managerid",
        "attributes.manager_id",
        "attributes.managerId",
        "attributes.managerID",
        "attributes.MANAGER_ID",
        "attributes.Manager ID",
      ],
    });
  }
  return stages;
}

const ACCOUNT_REFRESH_CURSOR_BATCH = 2000;

function indexIdentityForLifecycleLookup(row, map) {
  if (!row) return;
  if (row._id) map.set(`id:${String(row._id)}`, row);
  if (row.email) map.set(`email:${String(row.email).toLowerCase()}`, row);
  if (row.employeeId != null && String(row.employeeId).trim()) {
    map.set(`employeeId:${String(row.employeeId).trim()}`, row);
  }
  const uid = row.attributes?.uid;
  if (uid != null && String(uid).trim()) map.set(`uid:${String(uid).trim()}`, row);
}

function lookupIdentityBefore(map, filter = {}) {
  if (!filter || typeof filter !== "object") return null;
  if (filter.email) return map.get(`email:${String(filter.email).toLowerCase()}`) || null;
  if (filter.employeeId) return map.get(`employeeId:${String(filter.employeeId).trim()}`) || null;
  if (filter["attributes.uid"]) {
    return map.get(`uid:${String(filter["attributes.uid"]).trim()}`) || null;
  }
  if (filter._id) return map.get(`id:${String(filter._id)}`) || null;
  return null;
}

function newIdentityRefreshSyncJobId(profile, prefix = "identity-refresh") {
  const profileId = String(profile?._id || "profile");
  return `${prefix}:${profileId}:${Date.now()}:${randomUUID().slice(0, 8)}`;
}

/**
 * Shared P6 lifecycle seam: persist before/after identity transitions.
 * Call only from authoritative Identity upsert paths (profile refresh / HRMS).
 *
 * @param {object} opts
 * @param {Array} opts.transitions
 * @param {Function} [opts.enqueueBatch] test injection for enqueueLifecycleEventsBatch
 */
export async function enqueueLifecycleTransitionsFromRefresh({
  transitions = [],
  triggeredBy = "IDENTITY_REFRESH",
  syncJobId,
  sourceApplicationId,
  jmlCorrelationId,
  enqueueBatch,
} = {}) {
  if (!transitions.length) return { count: 0 };
  const enqueue =
    enqueueBatch ||
    (await import("../lifecycle/lifecycleEventService.js")).enqueueLifecycleEventsBatch;
  const payload = transitions
    .filter((t) => t?.identityId && t?.after)
    .map((t) => ({
      tenantId: t.tenantId,
      identityId: t.identityId,
      before: t.before || null,
      after: t.after,
      syncJobId: t.syncJobId || syncJobId,
      triggeredBy: t.triggeredBy || triggeredBy,
      sourceApplicationId: t.sourceApplicationId || sourceApplicationId,
      jmlCorrelationId: t.jmlCorrelationId || jmlCorrelationId,
    }));
  if (!payload.length) return { count: 0 };
  return enqueue(payload);
}

async function enqueueLifecycleAfterWrites({
  tenantId,
  Identity,
  chunkPrepared,
  existingByKey,
  syncJobId,
  sourceApplicationId,
}) {
  if (!chunkPrepared?.length) return;
  const afterFilters = chunkPrepared.map((p) => p.filter).filter(Boolean);
  const afterByKey = new Map();
  if (afterFilters.length) {
    const afterRows = await Identity.find({ $or: afterFilters }).lean();
    for (const row of afterRows) indexIdentityForLifecycleLookup(row, afterByKey);
  }

  const transitions = [];
  for (const prep of chunkPrepared) {
    const before = lookupIdentityBefore(existingByKey, prep.filter);
    const after = lookupIdentityBefore(afterByKey, prep.filter);
    if (!after?._id) continue;
    transitions.push({
      tenantId,
      identityId: after._id,
      before: before || null,
      after,
    });
  }
  await enqueueLifecycleTransitionsFromRefresh({
    transitions,
    syncJobId,
    sourceApplicationId,
    triggeredBy: "IDENTITY_REFRESH",
  });
}

function mappingsUseCustomTransform(mappings) {
  return (mappings || []).some((m) => m && m.customTransformId);
}

/**
 * Fast path: aggregation-pipeline upsert (no correlation prefetch) + chunked bulkWrite.
 * Used when correlation fallback is not configured (typical app-PK / employeeId / email feeds).
 */
async function processIdentityRowsUpsertBulk(profile, rows, rowNormalizer, options = {}) {
  const tenantId = profile.tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const LegacyIdentity = getLegacyIdentityModel();
  const mappings = normalizeMappingsPayload(profile.attributeMappings || []);
  const correlationTargetKey = canonicalIdentityMappingTargetKey(profile.correlationTargetKey || "email");
  const lifecycleRules = profile.lifecycleRules && typeof profile.lifecycleRules === "object" ? profile.lifecycleRules : {};
  const useCustom = mappingsUseCustomTransform(mappings);
  const transformCache = useCustom ? await buildTransformCacheForMappings(mappings, tenantId) : null;
  let upserted = 0;
  let skipped = 0;
  let skippedCorrelation = 0;
  let skippedMissingEmail = 0;
  let skippedMissingDisplayName = 0;
  const errors = [];

  const prepared = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const row = rowNormalizer(rows[i], i);
      const payload = useCustom
        ? await csvRowToIdentityPayload(row, mappings, tenantId, {
            lifecycleRules,
            transformCache,
          })
        : csvRowToIdentityPayloadSync(row, mappings, tenantId, {
            lifecycleRules,
            transformCache,
          });
      const primarySkip = shouldSkipCorrelation(correlationTargetKey, payload);
      ensureDisplayNameFromCorrelation(payload, correlationTargetKey);
      if (primarySkip) {
        skippedCorrelation += 1;
      }
      const filter = buildIdentityUpsertFilter(tenantId, correlationTargetKey, payload);
      prepared.push({ rowIndex: i, payload, filter, primarySkip });
    } catch (e) {
      errors.push({ row: i + 1, error: e.message });
    }
  }

  const bulkOps = [];
  const lifecycleCandidates = [];
  for (const p of prepared) {
    const pipeline = buildIdentityRefreshUpdatePipeline(profile, tenantId, p.payload);
    bulkOps.push({
      updateOne: {
        filter: p.filter,
        update: pipeline,
        upsert: true,
      },
    });
    lifecycleCandidates.push(p);
  }

  // Prefetch existing docs for before/after lifecycle detection.
  let existingByKey = new Map();
  try {
    const filters = lifecycleCandidates.map((p) => p.filter).filter(Boolean);
    if (filters.length) {
      const existingRows = await Identity.find({ $or: filters }).lean();
      for (const row of existingRows) indexIdentityForLifecycleLookup(row, existingByKey);
    }
  } catch (e) {
    console.warn("[lifecycle] prefetch for bulk refresh failed:", e.message);
    existingByKey = new Map();
  }

  const syncJobId =
    options.syncJobId || newIdentityRefreshSyncJobId(profile, "identity-refresh-bulk");

  for (let c = 0; c < bulkOps.length; c += IDENTITY_REFRESH_BULK_CHUNK) {
    const chunk = bulkOps.slice(c, c + IDENTITY_REFRESH_BULK_CHUNK);
    const chunkPrepared = lifecycleCandidates.slice(c, c + IDENTITY_REFRESH_BULK_CHUNK);
    try {
      await Identity.bulkWrite(chunk, { ordered: false });
      await mirrorIdentityBulkWriteToLegacy(chunk);
      upserted += chunk.length;
    } catch (e) {
      errors.push({ row: "bulk", error: e.message });
      for (let j = 0; j < chunk.length; j++) {
        try {
          const op = chunk[j];
          const f = op.updateOne.filter;
          const existing = await Identity.findOne(f).lean();
          const prep = prepared[c + j];
          const pl = clonePayloadForSetDoc(prep.payload);
          const { setDoc } = buildSetDocFromPayload(profile, tenantId, pl, existing);
          await Promise.all([
            Identity.updateOne(f, { $set: setDoc }, { upsert: true, runValidators: true }),
            LegacyIdentity.updateOne(f, { $set: setDoc }, { upsert: true, runValidators: true }),
          ]);
          upserted += 1;
        } catch (rowErr) {
          errors.push({ row: c + j + 1, error: rowErr.message });
        }
      }
    }

    // Durable lifecycle persistence — awaited so events exist before sync returns
    try {
      await enqueueLifecycleAfterWrites({
        tenantId,
        Identity,
        chunkPrepared,
        existingByKey,
        syncJobId,
        sourceApplicationId: profile.sourceApplicationId || profile.hrmsSourceId,
      });
    } catch (e) {
      console.warn("[lifecycle] bulk enqueue after identity refresh failed:", e.message);
    }
  }

  const skipManagers = options?.skipManagerResolution === true;
  const mgr = skipManagers
    ? { managersLinked: 0, processed: 0 }
    : await resolveManagersAfterRefresh(tenantId, profile);

  const hint =
    upserted > 0 || rows.length === 0
      ? null
      : buildRefreshZeroUpsertHint({
          correlationTargetKey,
          correlationFallbackKey: null,
          skippedCorrelation,
          skippedMissingEmail,
          skippedMissingDisplayName,
        });

  return {
    rowsProcessed: rows.length,
    identitiesUpserted: upserted,
    skippedNoEmailOrName: skipped,
    skippedCorrelation,
    skippedMissingEmail,
    skippedMissingDisplayName,
    managersLinked: mgr.managersLinked,
    managersProcessed: mgr.processed,
    hint,
    errors: errors.slice(0, 15),
    errorCount: errors.length,
  };
}

/** Sequential find + upsert (fallback correlation and legacy parity). */
async function processIdentityRowsUpsertSequential(profile, rows, rowNormalizer, options = {}) {
  const tenantId = profile.tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const LegacyIdentity = getLegacyIdentityModel();
  const mappings = normalizeMappingsPayload(profile.attributeMappings || []);
  const correlationTargetKey = canonicalIdentityMappingTargetKey(profile.correlationTargetKey || "email");
  const rawFb = profile.correlationFallbackKey || null;
  const correlationFallbackKey =
    rawFb && canonicalIdentityMappingTargetKey(rawFb) !== correlationTargetKey
      ? canonicalIdentityMappingTargetKey(rawFb)
      : null;
  const lifecycleRules = profile.lifecycleRules && typeof profile.lifecycleRules === "object" ? profile.lifecycleRules : {};
  const useCustom = mappingsUseCustomTransform(mappings);
  const transformCache = useCustom ? await buildTransformCacheForMappings(mappings, tenantId) : null;
  let upserted = 0;
  let skipped = 0;
  let skippedCorrelation = 0;
  let skippedMissingEmail = 0;
  let skippedMissingDisplayName = 0;
  const errors = [];

  const syncJobId =
    options.syncJobId || newIdentityRefreshSyncJobId(profile, "identity-refresh");
  const lifecycleTransitions = [];

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    try {
      const row = rowNormalizer(rawRow, i);
      const payload = useCustom
        ? await csvRowToIdentityPayload(row, mappings, tenantId, {
            lifecycleRules,
            transformCache,
          })
        : csvRowToIdentityPayloadSync(row, mappings, tenantId, {
            lifecycleRules,
            transformCache,
          });
      const primarySkip = shouldSkipCorrelation(correlationTargetKey, payload);
      const fbOk =
        correlationFallbackKey &&
        correlationFallbackKey !== correlationTargetKey &&
        !shouldSkipCorrelation(correlationFallbackKey, payload);
      ensureDisplayNameFromCorrelation(payload, correlationTargetKey);

      if (primarySkip && !fbOk) {
        skippedCorrelation += 1;
      }

      const { identity: existing, filter } = await findIdentityMatchForUpsert(
        tenantId,
        correlationTargetKey,
        correlationFallbackKey,
        payload,
      );

      const pl = clonePayloadForSetDoc(payload);
      const { setDoc } = buildSetDocFromPayload(profile, tenantId, pl, existing);
      const beforeSnap = existing ? { ...existing } : null;

      const [updated] = await Promise.all([
        Identity.findOneAndUpdate(filter, { $set: setDoc }, { upsert: true, new: true, runValidators: true }),
        LegacyIdentity.findOneAndUpdate(filter, { $set: setDoc }, { upsert: true, new: true, runValidators: true }),
      ]);
      upserted += 1;

      const afterDoc =
        updated && typeof updated.toObject === "function"
          ? updated.toObject()
          : updated || { ...setDoc, _id: existing?._id };
      if (afterDoc?._id) {
        lifecycleTransitions.push({
          tenantId,
          identityId: afterDoc._id,
          before: beforeSnap,
          after: afterDoc,
          syncJobId,
          triggeredBy: "IDENTITY_REFRESH",
          sourceApplicationId: profile.sourceApplicationId || profile.hrmsSourceId,
        });
      }
    } catch (e) {
      errors.push({ row: i + 1, error: e.message });
    }
  }

  if (lifecycleTransitions.length) {
    try {
      await enqueueLifecycleTransitionsFromRefresh({
        transitions: lifecycleTransitions,
        syncJobId,
        sourceApplicationId: profile.sourceApplicationId || profile.hrmsSourceId,
        triggeredBy: "IDENTITY_REFRESH",
      });
    } catch (e) {
      console.warn("[lifecycle] sequential enqueue after identity refresh failed:", e.message);
    }
  }

  const skipManagers = options?.skipManagerResolution === true;
  const mgr = skipManagers
    ? { managersLinked: 0, processed: 0 }
    : await resolveManagersAfterRefresh(tenantId, profile);

  const hint =
    upserted > 0 || rows.length === 0
      ? null
      : buildRefreshZeroUpsertHint({
          correlationTargetKey,
          correlationFallbackKey,
          skippedCorrelation,
          skippedMissingEmail,
          skippedMissingDisplayName,
        });

  return {
    rowsProcessed: rows.length,
    identitiesUpserted: upserted,
    skippedNoEmailOrName: skipped,
    skippedCorrelation,
    skippedMissingEmail,
    skippedMissingDisplayName,
    managersLinked: mgr.managersLinked,
    managersProcessed: mgr.processed,
    hint,
    errors: errors.slice(0, 15),
    errorCount: errors.length,
  };
}

async function processIdentityRowsUpsert(profile, rows, rowNormalizer, options = {}) {
  const primaryK = canonicalIdentityMappingTargetKey(profile.correlationTargetKey || "email");
  profile.correlationTargetKey = primaryK;
  const rawFb = profile.correlationFallbackKey || null;
  const fallbackK = rawFb ? canonicalIdentityMappingTargetKey(rawFb) : null;
  if (fallbackK && fallbackK !== primaryK) {
    profile.correlationFallbackKey = fallbackK;
    return processIdentityRowsUpsertSequential(profile, rows, rowNormalizer, options);
  }
  profile.correlationFallbackKey = null;
  return processIdentityRowsUpsertBulk(profile, rows, rowNormalizer, options);
}

/**
 * Explains why every row was skipped (refresh returned 0 upserts but had rows).
 */
function buildRefreshZeroUpsertHint({
  correlationTargetKey,
  correlationFallbackKey,
  skippedCorrelation,
  skippedMissingEmail,
  skippedMissingDisplayName,
}) {
  const parts = [];
  if (skippedCorrelation > 0) {
    const primary = correlationTargetKey || "email";
    const fb = correlationFallbackKey && correlationFallbackKey !== primary ? ` or ${correlationFallbackKey}` : "";
    parts.push(
      `${skippedCorrelation} row(s) skipped: primary correlation "${primary}"${fb ? ` (and fallback${fb})` : ""} had no value in mapped data — map those source fields or set a correlation fallback on the profile.`,
    );
  }
  if (skippedMissingEmail > 0) {
    parts.push(
      `${skippedMissingEmail} row(s) skipped: no email after mapping — add a mapping with target "email" (or first/last so displayName can be derived; email is still required).`,
    );
  }
  if (skippedMissingDisplayName > 0) {
    parts.push(
      `${skippedMissingDisplayName} row(s) skipped: no display name — map displayName or firstname/lastname, or ensure email is present for a fallback label.`,
    );
  }
  if (parts.length) return parts.join(" ");
  return "No rows were upserted. Check attribute mappings and CSV/schema field names match your uploaded data.";
}

/**
 * Stream materialized app users in batches so large imports (50k+) do not load all docs into RAM.
 */
async function runDelimitedIdentityRefreshFromUserCursor(UsersModel, applicationId, appForUsers, profile) {
  const cursor = UsersModel.find({ applicationId }).lean().cursor();
  const batches = [];
  let batch = [];
  for await (const doc of cursor) {
    batch.push(
      buildAccountUserRowForIdentityRefresh(doc, appForUsers.userMappings),
    );
    if (batch.length >= ACCOUNT_REFRESH_CURSOR_BATCH) {
      batches.push(batch);
      batch = [];
    }
  }
  if (batch.length) batches.push(batch);

  if (!batches.length) {
    throw new Error(
      "No data rows found for this source. Import users on Application → Application schema, run connector sync, or load delimited rows on the HRMS source, then run identity refresh again.",
    );
  }

  const partials = [];
  const allErrors = [];
  /** Rows are already normalized — do not run csvRowToAccountFields again (drops rawData / blanks fields). */
  const passThroughRow = (row) => row;
  const syncJobId = newIdentityRefreshSyncJobId(profile, "identity-refresh-delimited");
  for (const b of batches) {
    const r = await processIdentityRowsUpsert(profile, b, passThroughRow, {
      skipManagerResolution: true,
      syncJobId,
    });
    partials.push(r);
    if (r.errors?.length) allErrors.push(...r.errors);
  }

  const tenantId = profile.tenantId;
  const mgr = await resolveManagersAfterRefresh(tenantId, profile);
  const rowsProcessed = partials.reduce((s, p) => s + p.rowsProcessed, 0);
  const identitiesUpserted = partials.reduce((s, p) => s + p.identitiesUpserted, 0);
  const skippedCorrelation = partials.reduce((s, p) => s + p.skippedCorrelation, 0);
  const skippedMissingEmail = partials.reduce((s, p) => s + p.skippedMissingEmail, 0);
  const skippedMissingDisplayName = partials.reduce((s, p) => s + p.skippedMissingDisplayName, 0);
  const skipped = partials.reduce((s, p) => s + p.skippedNoEmailOrName, 0);
  const errorCount = partials.reduce((s, p) => s + (p.errorCount || 0), 0);

  const correlationTargetKey = canonicalIdentityMappingTargetKey(profile.correlationTargetKey || "email");
  const hint =
    identitiesUpserted > 0 || rowsProcessed === 0
      ? null
      : buildRefreshZeroUpsertHint({
          correlationTargetKey,
          correlationFallbackKey: null,
          skippedCorrelation,
          skippedMissingEmail,
          skippedMissingDisplayName,
        });

  return {
    rowsProcessed,
    identitiesUpserted,
    skippedNoEmailOrName: skipped,
    skippedCorrelation,
    skippedMissingEmail,
    skippedMissingDisplayName,
    managersLinked: mgr.managersLinked,
    managersProcessed: mgr.processed,
    hint,
    errors: allErrors.slice(0, 15),
    errorCount,
  };
}

/**
 * SailPoint-style Identity Refresh: apply mappings, upsert identities, link managers.
 * @param {object} profile - IdentityProfile lean document
 */
export async function runDelimitedIdentityRefresh(profile) {
  const tenantId = profile.tenantId;
  const mappings = normalizeMappingsPayload(profile.attributeMappings || []);
  if (!mappings.length) {
    throw new Error("Configure attribute mappings on this profile first.");
  }

  const mappingSourceMode = profile.mappingSourceMode || "delimited_csv";
  let correlationTargetKey = canonicalIdentityMappingTargetKey(profile.correlationTargetKey || "email");
  const correlationFallbackKey = profile.correlationFallbackKey || null;

  const sid = profile.sourceApplicationId || profile.hrmsSourceId;
  let appDoc = null;
  if (sid && mongoose.Types.ObjectId.isValid(String(sid))) {
    appDoc = await Application.findOne({ _id: sid, tenantId }).select("userMappings name").lean();
  }

  // Application onboarding PK (Schema Management) is the authoritative upsert key when present.
  // Must match the mapped target key canonicalization used in csvRowToIdentityPayload / upsert filters.
  if (appDoc && Array.isArray(appDoc.userMappings)) {
    const pkDef = appDoc.userMappings.find((m) => m.isPrimaryKey);
    if (pkDef && String(pkDef.standardField || "").trim()) {
      const pkField = String(pkDef.standardField).trim().toLowerCase();
      const mappedTarget = mappings.find(
        (m) => String(m.sourceAttribute || "").trim().toLowerCase() === pkField,
      );
      if (!mappedTarget?.targetKey) {
        throw new Error(
          `Application schema marks primary key on "${pkDef.standardField}". ` +
            `Map that schema field to an identity attribute on this profile (Mappings tab). Identity refresh uses that target as the unique upsert key.`,
        );
      }
      correlationTargetKey = canonicalIdentityMappingTargetKey(mappedTarget.targetKey);
      profile.correlationTargetKey = correlationTargetKey;
    }
  }

  const err = await validateAttributeMappings(tenantId, mappings, {
    mappingSourceMode,
    sourceApplicationId: sid,
  });
  if (err) throw new Error(err);

  const corrErr = validateCorrelationConfig(correlationTargetKey, correlationFallbackKey, mappings, {
    requireMappedCorrelation: false,
  });
  if (corrErr) throw new Error(corrErr);

  if (!sid) {
    throw new Error("Profile has no authoritative source application.");
  }

  /** App Registry doc for Schema Management blueprint (needed for live app users + account-schema mapping). */
  const appForUsers =
    appDoc ||
    (await Application.findOne({ _id: sid, tenantId }).select("userMappings name").lean());

  const rec = await resolveHrmsIntegrationRecord(tenantId, sid);
  if (!rec) {
    throw new Error("Profile source application not found. Select a valid source application on the profile settings.");
  }

  const rows =
    rec.delimitedImportRows?.length > 0 ? rec.delimitedImportRows : rec.delimitedPreviewRows || [];

  // Also fall back to the Application's own uploadedRows if the HRMS source has none
  let finalRows = rows;
  if (!finalRows.length) {
    const appRec = await Application.findOne({ _id: sid, tenantId }).select("uploadedRows hrms").lean();
    const appRows = appRec?.hrms?.delimitedImportRows?.length > 0
      ? appRec.hrms.delimitedImportRows
      : appRec?.hrms?.delimitedPreviewRows || [];
    finalRows = appRows;
  }

  const mapRow = (rawRow, i) =>
    mappingSourceMode === "application_account_schema" && appForUsers?.userMappings?.length
      ? csvRowToAccountFields(rawRow, appForUsers.userMappings)
      : rawRow;

  /**
   * Prefer materialized application users (Application schema / connector) when the collection has rows.
   * Cursor + batched upsert avoids loading every account into memory (50k+ support).
   */
  if (appForUsers?.userMappings?.length && appForUsers?.name) {
    const UsersModel = await getDynamicUserModelForTenantId(appForUsers.name, tenantId);
    const hasUsers = await UsersModel.exists({ applicationId: sid });
    if (hasUsers) {
      return runDelimitedIdentityRefreshFromUserCursor(UsersModel, sid, appForUsers, profile);
    }
  }

  if (!finalRows.length) {
    throw new Error(
      "No data rows found for this source. Import users on Application → Application schema, run connector sync, or load delimited rows on the HRMS source, then run identity refresh again.",
    );
  }

  return processIdentityRowsUpsert(profile, finalRows, mapRow, {
    syncJobId: newIdentityRefreshSyncJobId(profile, "identity-refresh-delimited"),
  });
}

/**
 * OrangeHRM API → same Identity Profile pipeline as delimited refresh (when profile + mappings exist).
 * @returns {Promise<object|null>} result or null to use legacy hardcoded HRMS mapping
 */
export async function runOrangeHrmIdentityRefresh(tenantId, applicationId, employees) {
  const profile = await IdentityProfile.findOne({
    tenantId,
    sourceApplicationId: applicationId,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!profile?.attributeMappings?.length) {
    return null;
  }

  const mappings = normalizeMappingsPayload(profile.attributeMappings || []);
  const mappingSourceMode = profile.mappingSourceMode || "delimited_csv";
  const correlationTargetKey = profile.correlationTargetKey || "email";
  const correlationFallbackKey = profile.correlationFallbackKey || null;

  const err = await validateAttributeMappings(tenantId, mappings, {
    mappingSourceMode,
    sourceApplicationId: profile.sourceApplicationId || profile.hrmsSourceId,
  });
  if (err) {
    return null;
  }

  const corrErr = validateCorrelationConfig(correlationTargetKey, correlationFallbackKey, mappings, {
    requireMappedCorrelation: true,
  });
  if (corrErr) {
    return null;
  }

  const app = await Application.findOne({ _id: applicationId, tenantId }).select("userMappings name").lean();
  if (!app?.userMappings?.length) {
    return null;
  }

  const { hrmsEmployeeToSchemaRow } = await import("../hrms/hrmsIdentitySyncService.js");
  return processIdentityRowsUpsert(
    profile,
    employees,
    (emp) => hrmsEmployeeToSchemaRow(emp, tenantId, applicationId, app.userMappings),
    {
      syncJobId: newIdentityRefreshSyncJobId(profile, `hrms-refresh:${String(applicationId)}`),
    },
  );
}

/**
 * Readiness for SailPoint-style checklist (schema, CSV sample, correlation).
 */
export async function getProfileReadiness(profile) {
  const tenantId = profile.tenantId;
  const sid = profile.sourceApplicationId || profile.hrmsSourceId;
  let schemaReady = false;
  let hasCsvSample = false;
  let userMappingCount = 0;
  const requiredFieldsPresent = {
    correlationMapped: false,
    emailMapped: false,
  };

  if (sid) {
    const app = await Application.findOne({ _id: sid, tenantId }).select("userMappings name").lean();
    userMappingCount = (app?.userMappings || []).length;
    schemaReady = userMappingCount > 0;

    const rec = await resolveHrmsIntegrationRecord(tenantId, sid);
    if (rec?.connector === "delimited_file") {
      const rows = rec.delimitedImportRows?.length ? rec.delimitedImportRows : rec.delimitedPreviewRows || [];
      hasCsvSample = rows.length > 0;
    }
    if (rec?.connector === "orangehrm") {
      hasCsvSample = true;
      schemaReady = schemaReady || true;
    }
  }

  const mappings = profile.attributeMappings || [];
  const ck = profile.correlationTargetKey || "email";
  requiredFieldsPresent.correlationMapped = mappings.some((m) => m.targetKey === ck);
  requiredFieldsPresent.emailMapped = mappings.some((m) => m.targetKey === "email");

  const steps = [
    { id: "source", label: "Authoritative HR application linked", ok: Boolean(sid) },
    { id: "schema", label: "Account schema (Schema Management) defined", ok: schemaReady },
    { id: "data", label: "Data loaded (CSV upload or API connected)", ok: hasCsvSample },
    { id: "profile", label: "Identity profile created", ok: true },
    { id: "mappings", label: "Attribute mappings configured", ok: mappings.length > 0 },
    { id: "correlation", label: "Correlation key mapped", ok: requiredFieldsPresent.correlationMapped },
  ];

  return {
    schemaReady,
    hasCsvSample,
    userMappingCount,
    requiredFieldsPresent,
    steps,
    readyForRefresh: Boolean(
      sid &&
        mappings.length > 0 &&
        requiredFieldsPresent.correlationMapped &&
        requiredFieldsPresent.emailMapped &&
        hasCsvSample,
    ),
  };
}
