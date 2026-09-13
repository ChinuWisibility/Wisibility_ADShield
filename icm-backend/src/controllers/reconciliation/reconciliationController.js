import Application from "../models/application/Application.js";
import {
  resolveTenantSlugFromTenantId,
  getReconciliationModels,
} from "../utils/applicationDynamicCollections.js";

async function loadApplication(req) {
  const application = await Application.findById(req.params.id).lean();
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    throw err;
  }
  return application;
}

function getModelsForApp(application) {
  return resolveTenantSlugFromTenantId(application.tenantId).then((tenantSlug) => {
    if (!tenantSlug) throw new Error("Could not resolve tenant slug");
    return {
      tenantSlug,
      models: getReconciliationModels(application.name, tenantSlug),
    };
  });
}

/**
 * GET /api/applications/:id/reconciliation/runs
 */
export async function listReconciliationRuns(req, res) {
  try {
    const application = await loadApplication(req);
    const { models } = await getModelsForApp(application);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;
    const filter = { applicationId: application._id };
    if (req.query.status) filter.status = String(req.query.status).toUpperCase();

    const [data, total] = await Promise.all([
      models.Runs.find(filter)
        .sort({ reconciliationDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      models.Runs.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Failed to list reconciliation runs",
    });
  }
}

/**
 * GET /api/applications/:id/reconciliation/runs/:runId
 */
export async function getReconciliationRun(req, res) {
  try {
    const application = await loadApplication(req);
    const { models } = await getModelsForApp(application);
    const run = await models.Runs.findOne({
      applicationId: application._id,
      runId: req.params.runId,
    }).lean();
    if (!run) {
      return res.status(404).json({ success: false, message: "Reconciliation run not found" });
    }
    res.json({ success: true, data: run });
  } catch (e) {
    res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Failed to get reconciliation run",
    });
  }
}

function flattenDeltaRows(deltas, runMetaById) {
  const rows = [];
  for (const d of deltas) {
    const runMeta = runMetaById.get(d.runId) || {};
    const reconDate = runMeta.reconciliationDate || d.changedAt;
    if (d.changeType === "NEW_USER" || d.changeType === "REMOVED_USER") {
      rows.push({
        identityKey: d.identityKey,
        changeType: d.changeType,
        attribute: null,
        oldValue: null,
        newValue: null,
        reconciliationDate: reconDate,
        runId: d.runId,
      });
      continue;
    }
    for (const ac of d.attributeChanges || []) {
      rows.push({
        identityKey: d.identityKey,
        changeType: d.changeType,
        attribute: ac.attribute,
        oldValue: ac.oldValue,
        newValue: ac.newValue,
        reconciliationDate: reconDate,
        runId: d.runId,
      });
    }
    const added = [];
    const removed = [];
    for (const ec of d.entitlementChanges || []) {
      if (ec.changeType === "ADDED") added.push(ec.entitlementName);
      if (ec.changeType === "REMOVED") removed.push(ec.entitlementName);
    }
    if (added.length || removed.length) {
      const fmt = (vals) =>
        vals.map((v) => String(v || "").trim().toUpperCase()).filter(Boolean).join(" | ") || null;
      rows.push({
        identityKey: d.identityKey,
        changeType: d.changeType,
        attribute: "entitlements",
        oldValue: fmt(removed),
        newValue: fmt(added),
        reconciliationDate: reconDate,
        runId: d.runId,
      });
    }
    if (!(d.attributeChanges?.length) && !(d.entitlementChanges?.length)) {
      rows.push({
        identityKey: d.identityKey,
        changeType: d.changeType,
        attribute: null,
        oldValue: null,
        newValue: null,
        reconciliationDate: reconDate,
        runId: d.runId,
      });
    }
  }
  return rows;
}

/**
 * GET /api/applications/:id/reconciliation/deltas
 * GET /api/applications/:id/reconciliation/runs/:runId/deltas
 */
export async function listReconciliationDeltas(req, res) {
  try {
    const application = await loadApplication(req);
    const { models } = await getModelsForApp(application);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { applicationId: application._id };
    const runId = req.params.runId || req.query.runId;
    if (runId) filter.runId = String(runId);
    if (req.query.changeType) filter.changeType = String(req.query.changeType).toUpperCase();
    if (req.query.identityKey) {
      filter.identityKey = new RegExp(
        String(req.query.identityKey).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    const [deltas, total] = await Promise.all([
      models.Delta.find(filter).sort({ changedAt: -1 }).skip(skip).limit(limit).lean(),
      models.Delta.countDocuments(filter),
    ]);

    const runIds = [...new Set(deltas.map((d) => d.runId))];
    const runs = await models.Runs.find({ runId: { $in: runIds } })
      .select("runId reconciliationDate")
      .lean();
    const runMetaById = new Map(runs.map((r) => [r.runId, r]));

    let flat = flattenDeltaRows(deltas, runMetaById);
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
      flat = flat.filter(
        (r) =>
          String(r.identityKey || "").toLowerCase().includes(q) ||
          String(r.attribute || "").toLowerCase().includes(q) ||
          String(r.oldValue || "").toLowerCase().includes(q) ||
          String(r.newValue || "").toLowerCase().includes(q),
      );
    }

    res.json({
      success: true,
      data: req.query.flatten !== "false" ? flat : deltas,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Failed to list reconciliation deltas",
    });
  }
}

/**
 * GET /api/applications/:id/reconciliation/runs/:runId/entitlement-deltas
 */
export async function listEntitlementDeltas(req, res) {
  try {
    const application = await loadApplication(req);
    const { models } = await getModelsForApp(application);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { applicationId: application._id };
    if (req.params.runId) filter.runId = req.params.runId;
    else if (req.query.runId) filter.runId = String(req.query.runId);

    const [data, total] = await Promise.all([
      models.EntitlementDelta.find(filter)
        .sort({ changedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      models.EntitlementDelta.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Failed to list entitlement deltas",
    });
  }
}

/**
 * GET /api/applications/:id/reconciliation/runs/:runId/snapshots
 */
export async function listRunSnapshots(req, res) {
  try {
    const application = await loadApplication(req);
    const { models } = await getModelsForApp(application);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const filter = {
      applicationId: application._id,
      runId: req.params.runId,
    };

    const [data, total] = await Promise.all([
      models.Snapshot.find(filter).sort({ identityKey: 1 }).skip(skip).limit(limit).lean(),
      models.Snapshot.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({
      success: false,
      message: e.message || "Failed to list snapshots",
    });
  }
}
