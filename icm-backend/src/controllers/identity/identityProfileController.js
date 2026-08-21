import mongoose from "mongoose";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import HrmsIntegration from "../../models/integrations/HrmsIntegration.js";
import Application from "../../models/application/Application.js";
import {
  IDENTITY_PROFILE_TARGET_KEYS,
  IDENTITY_CORRELATION_TARGET_KEYS,
  TRANSFORM_OPTIONS,
  MAPPING_SOURCE_MODES,
} from "../../constants/identityProfileTargets.js";
import {
  resolveMappedValueAsync,
  normalizeMappingsPayload,
  buildPreviewRowFromSample,
  buildTransformCacheForMappings,
} from "../../utils/identityProfileMappingUtils.js";
import Transform from "../../models/governance/Transform.js";
import { isPlatformPlaneUser } from "../../middleware/auth.js";
import {
  runDelimitedIdentityRefresh,
  getProfileReadiness,
  validateAttributeMappings,
} from "../../services/identityProfileRefreshService.js";
import { resolveHrmsIntegrationRecord } from "../../utils/hrmsConnectorResolve.js";
import {
  resolveApplicationDocForPreview,
  loadPreviewSampleRows,
} from "../../utils/applicationPreviewRows.js";
import { migrateHrmsIntegrationsIntoApplicationsOnce } from "../../utils/migrateHrmsIntoApplications.js";
import { ensureDelimitedHrmsStubApplicationsOnce } from "../../utils/ensureDelimitedHrmsStubs.js";
import { recomputeIdentityTenantStats, toTenantObjectId } from "../../services/identityTenantStatsService.js";
import {
  tryAcquireMaterializationLock,
  releaseMaterializationLock,
  getMaterializationLockStatusForTenant,
  resolveTenantIdForLock,
} from "../../services/tenantMaterializationLockService.js";
import {
  computeIdentityProfileDeletionImpact,
  executeIdentityProfileDeletion,
} from "../../services/identityProfileDeletionService.js";
import {
  createTenantBulkMaterializationJob,
  patchTenantBulkMaterializationJob,
  getTenantBulkMaterializationJobForTenant,
} from "../../services/tenantBulkMaterializationJobStore.js";
import { runBulkTenantMaterializationProfiles } from "../../services/tenantBulkMaterializationRunner.js";
import {
  buildIdentityCreateSchema,
  findIdentityAttributeValues,
  findIdentityReferenceOptions,
  loadTenantProfile,
} from "../../services/identity/identityCreateSchemaService.js";

const HRMS_POPULATE = "name connector connectionStatus isActive delimitedCsvHeaders delimitedPreviewRows";
const SOURCE_APP_SELECT = "name description tenantId connectorType hrms";

// FR-074: List Profiles
export const getIdentityProfiles = async (req, res) => {
  try {
    await migrateHrmsIntegrationsIntoApplicationsOnce();
    await ensureDelimitedHrmsStubApplicationsOnce();
    const filter = {};
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;

    const profiles = await IdentityProfile.find(filter)
      .populate("createdBy", "firstName lastName email")
      .populate("expectedApplications", "name _id")
      .populate("sourceApplicationId", SOURCE_APP_SELECT)
      .populate("hrmsSourceId", HRMS_POPULATE)
      .populate("attributeMappings.applicationId", SOURCE_APP_SELECT)
      .populate("attributeMappings.hrmsSourceId", HRMS_POPULATE)
      .sort({ createdAt: -1 });

    res
      .status(200)
      .json({ success: true, count: profiles.length, data: profiles });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// FR-075: Get Profile Details
export const getIdentityProfileById = async (req, res) => {
  try {
    await migrateHrmsIntegrationsIntoApplicationsOnce();
    const profile = await IdentityProfile.findById(req.params.id)
      .populate("createdBy", "firstName lastName email")
      .populate("expectedApplications", "name _id")
      .populate("sourceApplicationId", SOURCE_APP_SELECT)
      .populate("attributeMappings.applicationId", SOURCE_APP_SELECT)
      .populate("hrmsSourceId", HRMS_POPULATE)
      .populate("attributeMappings.hrmsSourceId", HRMS_POPULATE);

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Identity Profile not found" });
    }

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Form schema for manually creating an identity under this profile. */
export const getIdentityProfileCreateSchema = async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.scopedTenantId || req.user?.tenantId;
    const profile = await loadTenantProfile(req.params.id, tenantId);
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Identity Profile not found" });
    }
    return res.status(200).json({ success: true, data: buildIdentityCreateSchema(profile) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/** Profile-scoped, server-filtered options for manager/reference pickers. */
export const getIdentityProfileReferenceOptions = async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.scopedTenantId || req.user?.tenantId;
    if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({ success: false, message: "Valid tenantId required" });
    }
    const profile = await loadTenantProfile(req.params.id, tenantId);
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Identity Profile not found" });
    }
    const data = await findIdentityReferenceOptions({
      profile,
      tenantId,
      query: req.query.q,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/** Distinct values already stored for one mapped attribute — powers rule condition pickers. */
export const getIdentityProfileAttributeValues = async (req, res) => {
  try {
    const tenantId = req.query.tenantId || req.scopedTenantId || req.user?.tenantId;
    if (!tenantId || !mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({ success: false, message: "Valid tenantId required" });
    }
    const profile = await loadTenantProfile(req.params.id, tenantId);
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Identity Profile not found" });
    }
    const data = await findIdentityAttributeValues({
      profile,
      tenantId,
      field: req.query.field,
      query: req.query.q,
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// FR-076: Create Profile
export const createIdentityProfile = async (req, res) => {
  try {
    await migrateHrmsIntegrationsIntoApplicationsOnce();
    const { name, description, tenantId } = req.body || {};
    const sourceApplicationId = req.body?.sourceApplicationId || req.body?.hrmsSourceId;

    if (!name || !String(name).trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Profile name is required" });
    }
    if (!sourceApplicationId) {
      return res
        .status(400)
        .json({ success: false, message: "Authoritative source application is required" });
    }
    if (!tenantId) {
      return res
        .status(400)
        .json({ success: false, message: "tenantId is required" });
    }

    if (!mongoose.Types.ObjectId.isValid(String(sourceApplicationId))) {
      return res.status(400).json({ success: false, message: "Invalid source application id" });
    }

    const src = await resolveHrmsIntegrationRecord(tenantId, sourceApplicationId);
    if (!src || !src.connector) {
      return res.status(400).json({
        success: false,
        message: "Source must be an application with HR connector data (App Registry), or a legacy HRMS source.",
      });
    }

    const profile = await IdentityProfile.create({
      name: String(name).trim(),
      description: String(description || "").trim(),
      sourceApplicationId: src._id,
      hrmsSourceId: src.kind === "legacy" ? src._id : undefined,
      tenantId,
    });

    const populated = await IdentityProfile.findById(profile._id)
      .populate("sourceApplicationId", SOURCE_APP_SELECT)
      .populate("attributeMappings.applicationId", SOURCE_APP_SELECT)
      .populate("hrmsSourceId", HRMS_POPULATE)
      .populate("attributeMappings.hrmsSourceId", HRMS_POPULATE);

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "An Identity Profile with this name already exists.",
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// FR-077: Update Profile
export const updateIdentityProfile = async (req, res) => {
  try {
    const existing = await IdentityProfile.findById(req.params.id);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Identity Profile not found" });
    }

    const { name, description, tenantId } = req.body || {};
    const sourceApplicationId = req.body?.sourceApplicationId;
    const legacyHrmsId = req.body?.hrmsSourceId;
    const tid = tenantId || existing.tenantId;

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Profile name cannot be empty" });
    }

    const $set = {};
    if (name !== undefined) $set.name = String(name).trim();
    if (description !== undefined) $set.description = String(description || "").trim();
    if (sourceApplicationId !== undefined || legacyHrmsId !== undefined) {
      const sid = sourceApplicationId !== undefined ? sourceApplicationId : legacyHrmsId;
      if (sid === null || sid === "") {
        return res.status(400).json({ success: false, message: "Authoritative source cannot be cleared" });
      }
      if (!mongoose.Types.ObjectId.isValid(String(sid))) {
        return res.status(400).json({ success: false, message: "Invalid source application id" });
      }
      const src = await resolveHrmsIntegrationRecord(tid, sid);
      if (!src?.connector) {
        return res.status(400).json({
          success: false,
          message: "Source application not found or has no HR connector configuration.",
        });
      }
      $set.sourceApplicationId = src.kind === "application" ? src._id : undefined;
      $set.hrmsSourceId = src.kind === "legacy" ? src._id : null;
    }
    if (tenantId !== undefined) $set.tenantId = tenantId;

    // Allow legacy / advanced fields if present (mapping phase, etc.)
    const passthrough = [
      "riskTier",
      "certificationFrequencyDays",
      "isActive",
      "tags",
      "attributes",
      "expectedEntitlements",
      "expectedApplications",
      "attributeMappings",
      "mappingSourceMode",
      "correlationTargetKey",
      "correlationFallbackKey",
      "managerLinkBy",
      "managerCorrelation",
      "lifecycleRules",
      "attributeAuthority",
    ];
    for (const key of passthrough) {
      if (req.body[key] !== undefined) $set[key] = req.body[key];
    }

    const profile = await IdentityProfile.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, runValidators: true },
    )
      .populate("createdBy", "firstName lastName email")
      .populate("expectedApplications", "name _id")
      .populate("sourceApplicationId", SOURCE_APP_SELECT)
      .populate("attributeMappings.applicationId", SOURCE_APP_SELECT)
      .populate("hrmsSourceId", HRMS_POPULATE)
      .populate("attributeMappings.hrmsSourceId", HRMS_POPULATE);

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "An Identity Profile with this name already exists.",
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTargetAttributeMeta = async (req, res) => {
  try {
    let customTransforms = [];
    const tenantOid = isPlatformPlaneUser(req.user)
      ? req.query.tenantId && mongoose.Types.ObjectId.isValid(String(req.query.tenantId))
        ? new mongoose.Types.ObjectId(String(req.query.tenantId))
        : null
      : req.user?.tenantId
        ? new mongoose.Types.ObjectId(String(req.user.tenantId))
        : null;

    if (tenantOid) {
      customTransforms = await Transform.find({ tenantId: tenantOid })
        .select("name")
        .sort({ name: 1 })
        .lean();
    }

    res.status(200).json({
      success: true,
      data: {
        targets: IDENTITY_PROFILE_TARGET_KEYS,
        transforms: TRANSFORM_OPTIONS,
        customTransforms,
        correlationKeys: IDENTITY_CORRELATION_TARGET_KEYS,
        mappingSourceModes: MAPPING_SOURCE_MODES,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Union of target attributes mapped across identity profiles for a tenant (for Identities list columns). */
export const getTenantMappedIdentityFields = async (req, res) => {
  try {
    const tenantId = req.query.tenantId;
    const applicationId = req.query.applicationId;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
      return res.status(400).json({ success: false, message: "Valid tenantId is required" });
    }

    let profiles = await IdentityProfile.find({ tenantId }).lean();
    if (applicationId && mongoose.Types.ObjectId.isValid(String(applicationId))) {
      const aid = String(applicationId);
      profiles = profiles.filter((p) => {
        const sid = p.sourceApplicationId ? String(p.sourceApplicationId) : "";
        const hid = p.hrmsSourceId ? String(p.hrmsSourceId) : "";
        return sid === aid || hid === aid;
      });
    }

    /** Profile order = `createdAt` (oldest first), then each profile’s `attributeMappings` array order (drag order on Mappings tab). */
    const profilesSorted = [...profiles].sort(
      (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    );

    const labelByKey = new Map();
    for (const p of profilesSorted) {
      for (const m of p.attributeMappings || []) {
        const tk = String(m.targetKey || "").trim();
        if (!tk) continue;
        const lbl = String(m.targetLabel || tk).trim();
        if (!labelByKey.has(tk)) labelByKey.set(tk, lbl);
      }
    }

    const ordered = [];
    const seen = new Set();
    for (const p of profilesSorted) {
      for (const m of p.attributeMappings || []) {
        const tk = String(m.targetKey || "").trim();
        if (!tk || seen.has(tk)) continue;
        seen.add(tk);
        ordered.push({ targetKey: tk, label: labelByKey.get(tk) || tk });
      }
    }

    res.status(200).json({ success: true, data: ordered });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Distinct authoritative sources referenced by identity profiles (applications + legacy HRMS ids).
 */
export const getProfileSourceApplications = async (req, res) => {
  try {
    await migrateHrmsIntegrationsIntoApplicationsOnce();
    const filter = {};
    if (req.query.tenantId) filter.tenantId = req.query.tenantId;

    const profiles = await IdentityProfile.find(filter)
      .select("sourceApplicationId hrmsSourceId")
      .lean();

    const idToCount = new Map();
    for (const p of profiles) {
      const raw = p.sourceApplicationId || p.hrmsSourceId;
      if (!raw) continue;
      const k = String(raw);
      idToCount.set(k, (idToCount.get(k) || 0) + 1);
    }

    const ids = [...idToCount.keys()];
    if (ids.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const oidList = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const [apps, legacies] = await Promise.all([
      oidList.length
        ? Application.find({ _id: { $in: oidList } })
            .select("name description tenantId connectorType hrms status")
            .lean()
        : [],
      oidList.length
        ? HrmsIntegration.find({ _id: { $in: oidList } })
            .select("name description tenantId")
            .lean()
        : [],
    ]);

    const appById = new Map(apps.map((a) => [String(a._id), a]));
    const legById = new Map(legacies.map((h) => [String(h._id), h]));

    const data = [];
    for (const id of ids) {
      const count = idToCount.get(id);
      const app = appById.get(id);
      if (app) {
        data.push({
          _id: app._id,
          name: app.name,
          description: app.description || "",
          kind: "application",
          connectorType: app.connectorType,
          status: app.status,
          profileCount: count,
        });
        continue;
      }
      const leg = legById.get(id);
      if (leg) {
        data.push({
          _id: leg._id,
          name: leg.name,
          description: leg.description || "",
          kind: "legacy_hrms",
          profileCount: count,
        });
      }
    }

    data.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET readiness checklist (SailPoint-style order). */
export const getIdentityProfileReadiness = async (req, res) => {
  try {
    const profile = await IdentityProfile.findById(req.params.id).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    const data = await getProfileReadiness(profile);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Aggregation (delimited): confirms CSV rows are present on the HRMS integration record
 * (import via Application schema / connector as configured). This endpoint only validates row presence.
 */
export const postAggregateDelimitedCheck = async (req, res) => {
  try {
    const profile = await IdentityProfile.findById(req.params.id).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    const tenantId = profile.tenantId;
    const sid = profile.sourceApplicationId || profile.hrmsSourceId;
    if (!sid) {
      return res.status(400).json({ success: false, message: "Profile has no source application." });
    }
    const rec = await resolveHrmsIntegrationRecord(tenantId, sid);
    if (!rec || rec.connector !== "delimited_file") {
      return res.status(400).json({
        success: false,
        message: "Aggregation check applies to Delimited File HR sources.",
      });
    }
    const rows =
      rec.delimitedImportRows?.length > 0 ? rec.delimitedImportRows : rec.delimitedPreviewRows || [];
    res.status(200).json({
      success: true,
      data: {
        aggregated: rows.length > 0,
        rowCount: rows.length,
        sourceName: rec.name,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET — poll whether tenant identity materialization is locked (any user / browser). */
export const getMaterializationLockStatus = async (req, res) => {
  try {
    const tenantOid = resolveTenantIdForLock(req, req.query.tenantId);
    const status = await getMaterializationLockStatusForTenant(tenantOid);
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({ success: false, message: error.message });
  }
};

/** GET — poll async bulk materialization job started by POST …/materialization/bulk-refresh (202). */
export const getBulkTenantMaterializationJob = async (req, res) => {
  try {
    const tenantOid = resolveTenantIdForLock(req, req.query.tenantId);
    const job = getTenantBulkMaterializationJobForTenant(req.params.jobId, String(tenantOid));
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found or expired." });
    }
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.status(200).json({ success: true, data: job });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({ success: false, message: error.message });
  }
};

/**
 * POST — refresh all profiles that have mappings for a tenant under **one** enqueue lock.
 * Default **async**: returns `202` + `jobId`; work runs on the server (`setImmediate`). Poll GET
 * `/materialization/bulk-refresh/jobs/:jobId?tenantId=…` until `status` is `completed` or `failed`.
 * Pass `{ async: false }` for synchronous 200 (long HTTP hold) — scripts / backward compatibility only.
 */
export const postBulkTenantIdentityMaterialization = async (req, res) => {
  let tenantOid = null;
  let released = false;
  const releaseOnce = async (releaseReq) => {
    if (!tenantOid || released) return;
    released = true;
    await releaseMaterializationLock(tenantOid, releaseReq || req);
  };

  try {
    tenantOid = resolveTenantIdForLock(req, req.body?.tenantId || req.query?.tenantId);
    const ac = await tryAcquireMaterializationLock(tenantOid, req, "bulk_identity_refresh");
    if (!ac.ok) {
      return res.status(409).json({
        success: false,
        code: "MATERIALIZATION_LOCKED",
        message:
          "Another identity sync is already running for this tenant. Wait for it to finish or ask the owner to complete it.",
        lock: ac.lock,
      });
    }

    const profiles = await IdentityProfile.find({
      tenantId: tenantOid,
      "attributeMappings.0": { $exists: true },
    }).lean();

    const usable = (profiles || []).filter((p) => Array.isArray(p.attributeMappings) && p.attributeMappings.length > 0);
    if (!usable.length) {
      await releaseOnce(req);
      return res.status(400).json({
        success: false,
        message:
          "No identity profiles with attribute mappings. Add mappings under Identity Profiles → Mapping first.",
      });
    }

    const asyncMode = req.body?.async !== false;

    if (!asyncMode) {
      try {
        const result = await runBulkTenantMaterializationProfiles(tenantOid, usable);
        setImmediate(() => {
          void recomputeIdentityTenantStats(tenantOid).catch((e) =>
            console.error("[bulk-identity-refresh] tenant stats recompute failed", e?.message || e),
          );
        });
        await releaseOnce(req);
        return res.status(200).json({ success: true, data: result });
      } catch (e) {
        await releaseOnce(req);
        throw e;
      }
    }

    const jobId = createTenantBulkMaterializationJob(String(tenantOid));
    const releaseReq = { user: req.user };

    setImmediate(() => {
      void (async () => {
        try {
          patchTenantBulkMaterializationJob(jobId, {
            status: "running",
            phase: "identity_refresh",
            percent: 5,
            message: "Running identity refresh on server (reading materialized accounts from DB)…",
            startedAt: Date.now(),
          });
          const result = await runBulkTenantMaterializationProfiles(tenantOid, usable);
          patchTenantBulkMaterializationJob(jobId, {
            status: "completed",
            phase: "done",
            percent: 100,
            message: "Completed.",
            result,
            completedAt: Date.now(),
          });
          setImmediate(() => {
            void recomputeIdentityTenantStats(tenantOid).catch((e) =>
              console.error("[bulk-identity-refresh] tenant stats recompute failed", e?.message || e),
            );
          });
        } catch (e) {
          console.error("[bulk-identity-refresh] async job failed", e?.message || e);
          patchTenantBulkMaterializationJob(jobId, {
            status: "failed",
            phase: "error",
            error: e.message || String(e),
            completedAt: Date.now(),
          });
        } finally {
          await releaseMaterializationLock(tenantOid, releaseReq);
        }
      })();
    });

    return res.status(202).json({
      success: true,
      data: {
        jobId,
        status: "queued",
        message:
          "Identity refresh is running on the server. Poll GET /api/identity-profiles/materialization/bulk-refresh/jobs/{jobId}?tenantId=… until status is completed, then reload your identities list.",
      },
    });
  } catch (error) {
    await releaseOnce(req);
    const code = error.statusCode || 500;
    if (code >= 400 && code < 500) {
      return res.status(code).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Identity Refresh: mappings → upsert identities → manager correlation (delimited sources). */
export const postIdentityRefresh = async (req, res) => {
  let tenantOid = null;
  try {
    const profile = await IdentityProfile.findById(req.params.id).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    tenantOid = toTenantObjectId(profile.tenantId);
    resolveTenantIdForLock(req, profile.tenantId);

    const ac = await tryAcquireMaterializationLock(tenantOid, req, "identity_refresh");
    if (!ac.ok) {
      return res.status(409).json({
        success: false,
        code: "MATERIALIZATION_LOCKED",
        message:
          "Another identity sync is already running for this tenant. Wait for it to finish or ask the owner to complete it.",
        lock: ac.lock,
      });
    }

    const t0 = Date.now();
    const data = await runDelimitedIdentityRefresh(profile);
    console.log(
      `[identity-refresh] profile=${req.params.id} rowsProcessed=${data?.rowsProcessed ?? "?"} ` +
        `identitiesUpserted=${data?.identitiesUpserted ?? "?"} ${Date.now() - t0}ms`,
    );
    res.status(200).json({ success: true, data });
    setImmediate(() => {
      void recomputeIdentityTenantStats(profile.tenantId).catch((e) =>
        console.error("[identity-refresh] tenant stats recompute failed", e?.message || e),
      );
    });
  } catch (error) {
    const code = error.statusCode || (error.message ? 400 : 500);
    if (code === 403 || code === 400) {
      return res.status(code).json({ success: false, message: error.message });
    }
    res.status(400).json({ success: false, message: error.message });
  } finally {
    if (tenantOid) {
      await releaseMaterializationLock(tenantOid, req);
    }
  }
};

/** @deprecated Use POST /identity-refresh — kept for backward compatibility. */
export const postImportIdentitiesFromDelimited = async (req, res) => {
  let tenantOid = null;
  try {
    const profile = await IdentityProfile.findById(req.params.id).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    tenantOid = toTenantObjectId(profile.tenantId);
    resolveTenantIdForLock(req, profile.tenantId);

    const ac = await tryAcquireMaterializationLock(tenantOid, req, "import_delimited");
    if (!ac.ok) {
      return res.status(409).json({
        success: false,
        code: "MATERIALIZATION_LOCKED",
        message:
          "Another identity sync is already running for this tenant. Wait for it to finish or ask the owner to complete it.",
        lock: ac.lock,
      });
    }

    const data = await runDelimitedIdentityRefresh(profile);
    res.status(200).json({ success: true, data });
    setImmediate(() => {
      void recomputeIdentityTenantStats(profile.tenantId).catch((e) =>
        console.error("[identity-import-delimited] tenant stats recompute failed", e?.message || e),
      );
    });
  } catch (error) {
    const code = error.statusCode || 400;
    if (code === 403) {
      return res.status(403).json({ success: false, message: error.message });
    }
    res.status(400).json({ success: false, message: error.message });
  } finally {
    if (tenantOid) {
      await releaseMaterializationLock(tenantOid, req);
    }
  }
};

/** Save only attribute mappings (Mappings tab). */
export const putIdentityProfileMappings = async (req, res) => {
  let tenantOid = null;
  let lockHeld = false;
  const syncIdentities = req.body?.syncIdentities === true;

  try {
    const profile = await IdentityProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    const tenantId = profile.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Profile has no tenant" });
    }
    tenantOid = toTenantObjectId(tenantId);
    resolveTenantIdForLock(req, tenantId);

    const norm = normalizeMappingsPayload(req.body.attributeMappings || []);
    const mode = req.body.mappingSourceMode ?? profile.mappingSourceMode ?? "delimited_csv";
    const corr = req.body.correlationTargetKey ?? profile.correlationTargetKey ?? "email";
    let corrFb = req.body.correlationFallbackKey;
    if (corrFb === "" || corrFb === null) corrFb = undefined;
    if (corrFb !== undefined && corrFb !== null) corrFb = String(corrFb);

    const err = await validateAttributeMappings(tenantId, norm, {
      mappingSourceMode: mode,
      sourceApplicationId: profile.sourceApplicationId || profile.hrmsSourceId,
    });
    if (err) {
      return res.status(400).json({ success: false, message: err });
    }

    const ma = String(profile.managerCorrelation?.managerAttribute || "").trim();
    const ra = String(profile.managerCorrelation?.referenceAttribute || "").trim();
    if (!ma || !ra) {
      return res.status(400).json({
        success: false,
        message:
          "Choose Manager key field and Reference field in Identity Profile Settings before saving mappings.",
      });
    }
    const targetKeys = new Set(norm.map((m) => String(m.targetKey || "").trim()).filter(Boolean));
    if (!targetKeys.has(ma) || !targetKeys.has(ra)) {
      return res.status(400).json({
        success: false,
        message:
          "Manager correlation fields must match target attributes in this mapping. Update Settings or mappings and try again.",
      });
    }
    if (ma === ra) {
      return res.status(400).json({
        success: false,
        message: "Manager key field and Reference field must be two different attributes.",
      });
    }

    profile.attributeMappings = norm;
    profile.mappingSourceMode = mode;
    profile.correlationTargetKey = corr;
    profile.correlationFallbackKey = corrFb || undefined;
    if (req.body.managerLinkBy !== undefined) {
      profile.managerLinkBy = req.body.managerLinkBy === "employeeId" ? "employeeId" : "email";
    }
    if (req.body.lifecycleRules !== undefined) {
      profile.lifecycleRules = req.body.lifecycleRules;
    }
    if (req.body.attributeAuthority !== undefined) {
      profile.attributeAuthority = Array.isArray(req.body.attributeAuthority) ? req.body.attributeAuthority : [];
    }

    if (syncIdentities) {
      const ac = await tryAcquireMaterializationLock(tenantOid, req, "mappings_save_and_sync");
      if (!ac.ok) {
        return res.status(409).json({
          success: false,
          code: "MATERIALIZATION_LOCKED",
          message:
            "Another identity sync is already running for this tenant. Wait for it to finish or ask the owner to complete it.",
          lock: ac.lock,
        });
      }
      lockHeld = true;
    }

    await profile.save();

    // Clear draft on successful final save (draft served its purpose)
    try {
      await IdentityProfile.findByIdAndUpdate(profile._id, {
        $set: {
          "mappingDraft.isDraft": false,
          "mappingDraft.mappingDraftData": [],
        },
      });
    } catch (e) {
      console.warn("[identity-profile] draft clear after save failed (non-fatal)", e?.message || e);
    }

    let syncResult = null;
    if (syncIdentities) {
      const lean = await IdentityProfile.findById(profile._id).lean();
      syncResult = await runDelimitedIdentityRefresh(lean);
      try {
        await recomputeIdentityTenantStats(tenantId);
      } catch (e) {
        console.error("[identity-profile] tenant stats recompute after sync failed", e?.message || e);
      }
    } else {
      try {
        await recomputeIdentityTenantStats(tenantId);
      } catch (e) {
        console.error("[identity-profile] tenant stats recompute failed", e?.message || e);
      }
    }

    const updated = await IdentityProfile.findById(profile._id)
      .populate("sourceApplicationId", SOURCE_APP_SELECT)
      .populate("attributeMappings.applicationId", SOURCE_APP_SELECT)
      .populate("hrmsSourceId", HRMS_POPULATE)
      .populate("attributeMappings.hrmsSourceId", HRMS_POPULATE);

    res.status(200).json({ success: true, data: updated, syncResult });
  } catch (error) {
    const code = error.statusCode || 500;
    if (code === 403 || code === 400) {
      return res.status(code).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (lockHeld && tenantOid) {
      await releaseMaterializationLock(tenantOid, req);
    }
  }
};

function formatPreviewRowLabel(row, i) {
  if (!row || typeof row !== "object") return `Row ${i + 1}`;
  const keys = Object.keys(row);
  const parts = [];
  for (const k of keys.slice(0, 6)) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") parts.push(String(v).trim());
  }
  return parts.length ? parts.join(", ") : `Row ${i + 1}`;
}

/** Preview resolved values for a chosen preview row index (per HRMS source). */
export const postIdentityProfileMappingsPreview = async (req, res) => {
  try {
    const profile = await IdentityProfile.findById(req.params.id).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    const tenantId = profile.tenantId;
    const mappings = normalizeMappingsPayload(req.body.attributeMappings || profile.attributeMappings);
    const mappingSourceMode =
      req.body.mappingSourceMode ?? profile.mappingSourceMode ?? "application_account_schema";

    let previewRowIndex = Number.parseInt(String(req.body.previewRowIndex ?? "0"), 10);
    if (Number.isNaN(previewRowIndex) || previewRowIndex < 0) previewRowIndex = 0;

    const profileSourceId = profile.sourceApplicationId || profile.hrmsSourceId;

    const err = await validateAttributeMappings(tenantId, mappings, {
      mappingSourceMode,
      sourceApplicationId: profileSourceId,
    });
    if (err) {
      return res.status(400).json({ success: false, message: err });
    }

    const previewCache = new Map();
    const getCachedPreviewRows = async (appRef) => {
      const key = String(appRef || "");
      if (previewCache.has(key)) return previewCache.get(key);
      const appDoc = await resolveApplicationDocForPreview(tenantId, appRef, profileSourceId);
      const loaded = await loadPreviewSampleRows(tenantId, appRef, appDoc, { limit: 5 });
      const prCapped = loaded.pr.slice(0, 5);
      previewCache.set(key, { ...loaded, pr: prCapped, appDoc });
      return previewCache.get(key);
    };

    const transformCache = await buildTransformCacheForMappings(mappings, tenantId);
    const rows = [];
    for (const m of mappings) {
      const appRef = m.applicationId || m.hrmsSourceId;
      const { pr, rec, appDoc } = await getCachedPreviewRows(appRef);

      const idx = pr.length ? Math.min(previewRowIndex, pr.length - 1) : 0;
      const sample = pr.length ? pr[idx] : {};
      const row = buildPreviewRowFromSample(sample, appDoc?.userMappings, mappingSourceMode);
      const raw = row[m.sourceAttribute] ?? "";
      const value = await resolveMappedValueAsync(m, row, tenantId, { transformCache });
      rows.push({
        targetKey: m.targetKey,
        targetLabel: m.targetLabel,
        sourceAttribute: m.sourceAttribute,
        transform: m.transform,
        customTransformId: m.customTransformId || undefined,
        rawSample: raw,
        resolved: value,
        hrmsSourceName: rec?.name || "",
      });
    }

    let previewRowCount = 0;
    let previewRowLabels = [];
    let hint = null;
    if (mappings.length > 0) {
      const firstRef = mappings[0].applicationId || mappings[0].hrmsSourceId;
      const { pr: prMeta } = await getCachedPreviewRows(firstRef);
      previewRowCount = prMeta.length;
      previewRowLabels = prMeta.map((row, i) => formatPreviewRowLabel(row, i));
      if (!prMeta.length) {
        hint =
          "No sample rows for this source. Open the application → Application schema: define user mappings, import users there if needed, and/or run connector sync so accounts appear under Application → Users. Ensure each mapping Attribute matches a technical name (standardField) on Application schema and csvColumn matches file headers.";
      } else {
        const allEmpty = rows.length > 0 && rows.every((r) => !String(r.resolved ?? "").trim());
        if (allEmpty) {
          hint =
            "Rows loaded but values did not resolve. On Application schema, check csvColumn ↔ headers and standardField names; each mapping Attribute here must match the schema technical name.";
        }
      }
    }

    res.status(200).json({
      success: true,
      data: { rows, previewRowIndex, previewRowCount, previewRowLabels, hint },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET — structured impact of deleting this profile (identities, account links, correlation, roles, …). */
export const getIdentityProfileDeletionImpact = async (req, res) => {
  try {
    const impact = await computeIdentityProfileDeletionImpact(req.params.id);
    if (!impact) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }
    res.status(200).json({ success: true, data: impact });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// FR-078: Delete Profile (with cascade when linked identities exist)
export const deleteIdentityProfile = async (req, res) => {
  try {
    const result = await executeIdentityProfileDeletion(req.params.id, req, {
      confirmDeletion: req.body?.confirmDeletion === true,
      deleteLinkedIdentities: req.body?.deleteLinkedIdentities === true,
    });

    if (!result.ok) {
      if (result.code === "DELETION_REQUIRES_CONFIRM") {
        return res.status(400).json({
          success: false,
          code: result.code,
          message: result.message,
          data: result.impact,
        });
      }
      return res.status(result.status || 500).json({
        success: false,
        message: result.message || "Delete failed",
      });
    }

    res.status(result.status || 200).json({
      success: true,
      message: result.message,
      data: result.data || {},
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /:id/draft — save mapping rows as draft without final validation.
 * No manager correlation check, no identity sync.
 */
export const patchIdentityProfileDraft = async (req, res) => {
  try {
    const profile = await IdentityProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }

    const mappingDraftData = Array.isArray(req.body?.mappingDraftData)
      ? req.body.mappingDraftData
      : [];

    const currentVersion = profile.mappingDraft?.draftVersion ?? 0;

    await IdentityProfile.findByIdAndUpdate(req.params.id, {
      $set: {
        "mappingDraft.isDraft": true,
        "mappingDraft.draftSavedAt": new Date(),
        "mappingDraft.draftVersion": currentVersion + 1,
        "mappingDraft.mappingDraftData": mappingDraftData,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        isDraft: true,
        draftSavedAt: new Date().toISOString(),
        draftVersion: currentVersion + 1,
        rowCount: mappingDraftData.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /:id/draft — clear draft state (called automatically after a successful final save,
 * or can be called explicitly to discard a draft).
 */
export const clearIdentityProfileDraft = async (req, res) => {
  try {
    const profile = await IdentityProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }

    await IdentityProfile.findByIdAndUpdate(req.params.id, {
      $set: {
        "mappingDraft.isDraft": false,
        "mappingDraft.mappingDraftData": [],
        "mappingDraft.draftSavedAt": null,
      },
    });

    res.status(200).json({ success: true, message: "Draft cleared." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /:id/manager-correlation-preview — sample values from one source row
 * (same row loading as POST mappings/preview).
 */
export const getManagerCorrelationPreview = async (req, res) => {
  try {
    const profile = await IdentityProfile.findById(req.params.id).lean();
    if (!profile) {
      return res.status(404).json({ success: false, message: "Identity Profile not found" });
    }

    const tenantId = profile.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Profile has no tenant." });
    }

    const { managerAttribute, referenceAttribute } = req.query;
    if (!managerAttribute || !referenceAttribute) {
      return res.status(400).json({
        success: false,
        message: "Both managerAttribute and referenceAttribute query params are required.",
      });
    }
    if (managerAttribute === referenceAttribute) {
      return res.status(400).json({
        success: false,
        message: "managerAttribute and referenceAttribute must be different fields.",
      });
    }

    const profileSourceId = profile.sourceApplicationId || profile.hrmsSourceId;
    if (!profileSourceId) {
      return res.status(400).json({
        success: false,
        message: "Identity Profile has no source application configured. Add a source on the Settings tab first.",
      });
    }

    const allMappings = Array.isArray(profile.attributeMappings) ? profile.attributeMappings : [];
    const draftMappings =
      profile.mappingDraft?.isDraft && Array.isArray(profile.mappingDraft?.mappingDraftData) && profile.mappingDraft.mappingDraftData.length > 0
        ? profile.mappingDraft.mappingDraftData
        : null;
    const effectiveMappings = draftMappings || allMappings;

    const mgrMappingRow = effectiveMappings.find(
      (m) => String(m.targetKey || "").trim() === managerAttribute,
    );
    const refMappingRow = effectiveMappings.find(
      (m) => String(m.targetKey || "").trim() === referenceAttribute,
    );

    if (!mgrMappingRow || !refMappingRow) {
      return res.status(200).json({
        success: true,
        data: {
          managerAttribute,
          referenceAttribute,
          managerValue: null,
          referenceValue: null,
          hint: "Both selected fields must be mapped on the Mapping tab before preview can run.",
        },
      });
    }

    const appRef = mgrMappingRow.applicationId || mgrMappingRow.hrmsSourceId || profileSourceId;
    const appDoc = await resolveApplicationDocForPreview(tenantId, appRef, profileSourceId);
    if (!appDoc?.userMappings?.length) {
      return res.status(200).json({
        success: true,
        data: {
          managerAttribute,
          referenceAttribute,
          managerValue: null,
          referenceValue: null,
          hint: "The source application has no user schema (userMappings) defined. Open the Application → Application schema tab and configure field mappings first.",
        },
      });
    }

    const mappingSourceMode = profile.mappingSourceMode ?? "application_account_schema";
    const { pr } = await loadPreviewSampleRows(tenantId, appRef, appDoc, { limit: 5 });

    if (!pr.length) {
      return res.status(200).json({
        success: true,
        data: {
          managerAttribute,
          referenceAttribute,
          managerValue: null,
          referenceValue: null,
          hint: "No sample rows for this source. Open the application → Application schema: define user mappings, import users if needed, and/or run connector sync so accounts appear under Application → Users.",
        },
      });
    }

    const sample = pr[0];
    const row = buildPreviewRowFromSample(sample, appDoc.userMappings, mappingSourceMode);
    const transformCache = await buildTransformCacheForMappings([mgrMappingRow, refMappingRow], tenantId);

    const pickResolved = async (mappingRow) => {
      const raw = row[mappingRow.sourceAttribute] ?? "";
      const value = await resolveMappedValueAsync(mappingRow, row, tenantId, { transformCache });
      const v = value ?? raw;
      if (v === null || v === undefined || String(v).trim() === "") return null;
      return String(v).trim();
    };

    const [managerValue, referenceValue] = await Promise.all([
      pickResolved(mgrMappingRow),
      pickResolved(refMappingRow),
    ]);

    res.status(200).json({
      success: true,
      data: { managerAttribute, referenceAttribute, managerValue, referenceValue },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

