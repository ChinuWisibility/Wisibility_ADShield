import mongoose from "mongoose";
import DiscoveryPolicy from "../../models/discovery/DiscoveryPolicy.js";
import DiscoveryResult from "../../models/discovery/DiscoveryResult.js";
import Entitlement from "../../models/access/Entitlement.js";
import Account from "../../models/access/Account.js";
import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import Application from "../../models/application/Application.js";
import {
  runDiscoveryPolicy,
  runAllDiscoveryPolicies,
  nextDiscoveryPolicyId,
} from "../../services/discovery/discoveryEvaluationService.js";
import { getAvailableFields } from "../../services/discovery/discoveryFieldService.js";
import { AppError } from "../../middleware/errorHandler.js";

/* ── Tenant scoping helper ─────────────────────────────────────────── */

function tenantFilter(user) {
  if (!user) return {};
  if (user.role === "superAdmin" || (user.role === "admin" && !user.tenantId))
    return {};
  return user.tenantId ? { tenantId: user.tenantId } : {};
}

/** Reject empty name / app / condition values (Mongoose required allows ""). */
function assertDiscoveryPolicyPayload(data) {
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  if (!name) throw new AppError("Policy name is required", 400);
  data.name = name;

  if (!data?.applicationId) {
    throw new AppError("Application is required", 400);
  }

  const steps = Array.isArray(data?.steps) ? data.steps : [];
  let hasValidCondition = false;

  for (const step of steps) {
    for (const fc of step?.fieldConditions || []) {
      const fieldName = String(fc?.fieldName || "").trim();
      for (const condition of fc?.conditions || []) {
        const value = String(condition?.value ?? "").trim();
        if (fieldName && !value) {
          throw new AppError("Condition value is required", 400);
        }
        if (fieldName && value) hasValidCondition = true;
      }
    }
  }

  if (!hasValidCondition) {
    throw new AppError("At least one condition value is required", 400);
  }
}

function extractEntitlementDescription(entitlement) {
  const raw = entitlement?.rawData || {};
  return (
    entitlement?.entitlement_description ||
    entitlement?.entitlementDescription ||
    entitlement?.entitlement_desc ||
    entitlement?.description ||
    entitlement?.desc ||
    entitlement?.summary ||
    raw.entitlement_description ||
    raw.entitlementDescription ||
    raw.entitlement_desc ||
    raw.description ||
    raw.desc ||
    raw.summary ||
    ""
  );
}

/* ════════════════════════════════════════════════════════════════════
 * POLICY CRUD
 * ════════════════════════════════════════════════════════════════════ */

/** GET /policies — paginated list */
export async function listPolicies(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      applicationId,
      sort,
      order,
    } = req.query;
    const query = { ...tenantFilter(req.user) };

    if (type) query.type = type;
    if (applicationId) query.applicationId = applicationId;
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { policyId: new RegExp(search, "i") },
        { applicationName: new RegExp(search, "i") },
      ];
    }

    const sortObj = sort
      ? { [sort]: order === "desc" ? -1 : 1 }
      : { createdAt: -1 };
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      DiscoveryPolicy.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      DiscoveryPolicy.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        items,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /policies/:id */
export async function getPolicyById(req, res, next) {
  try {
    const query = { _id: req.params.id, ...tenantFilter(req.user) };
    const policy = await DiscoveryPolicy.findOne(query).lean();
    if (!policy) throw new AppError("Discovery policy not found", 404);
    res.json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
}

/** POST /policies */
export async function createPolicy(req, res, next) {
  try {
    const data = { ...req.body };
    assertDiscoveryPolicyPayload(data);
    if (req.user) {
      data.createdBy = req.user.id;
      if (req.user.tenantId) data.tenantId = req.user.tenantId;
    }
    if (!data.policyId) {
      data.policyId = await nextDiscoveryPolicyId(req.user?.tenantId);
    }

    const policy = await DiscoveryPolicy.create(data);
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
}

/** PUT /policies/:id */
export async function updatePolicy(req, res, next) {
  try {
    const data = { ...req.body };
    assertDiscoveryPolicyPayload(data);
    if (req.user) data.updatedBy = req.user.id;

    const query = { _id: req.params.id, ...tenantFilter(req.user) };
    const policy = await DiscoveryPolicy.findOneAndUpdate(query, data, {
      new: true,
      runValidators: true,
    });
    if (!policy) throw new AppError("Discovery policy not found", 404);
    res.json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
}

/** DELETE /policies/:id */
export async function deletePolicy(req, res, next) {
  try {
    const query = { _id: req.params.id, ...tenantFilter(req.user) };
    const policy = await DiscoveryPolicy.findOneAndDelete(query);
    if (!policy) throw new AppError("Discovery policy not found", 404);

    // Clean up associated results
    await DiscoveryResult.deleteMany({ policyId: policy._id }).catch(() => {});

    res.json({ success: true, data: { message: "Discovery policy deleted" } });
  } catch (err) {
    next(err);
  }
}

/** POST /policies/:id/clone */
export async function clonePolicy(req, res, next) {
  try {
    const query = { _id: req.params.id, ...tenantFilter(req.user) };
    const source = await DiscoveryPolicy.findOne(query).lean();
    if (!source) throw new AppError("Discovery policy not found", 404);

    const newPolicyId = await nextDiscoveryPolicyId(req.user?.tenantId);
    const clone = { ...source };
    delete clone._id;
    delete clone.createdAt;
    delete clone.updatedAt;
    clone.policyId = newPolicyId;
    clone.name = `${source.name} (Copy)`;
    clone.totalMatches = 0;
    clone.lastEvaluatedAt = null;
    if (req.user) clone.createdBy = req.user.id;

    // Generate new _ids for embedded steps
    if (clone.steps) {
      clone.steps = clone.steps.map((s) => {
        const step = { ...s };
        delete step._id;
        return step;
      });
    }

    const policy = await DiscoveryPolicy.create(clone);
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
}

/** GET /policies/next-id */
export async function getNextPolicyId(req, res, next) {
  try {
    const nextId = await nextDiscoveryPolicyId(req.user?.tenantId);
    res.json({ success: true, data: { policyId: nextId } });
  } catch (err) {
    next(err);
  }
}

/** GET /policies/stats */
export async function getPolicyStats(req, res, next) {
  try {
    const tf = tenantFilter(req.user);
    const total = await DiscoveryPolicy.countDocuments(tf);

    const totalResults = await DiscoveryResult.countDocuments(tf);
    const byType = await DiscoveryPolicy.aggregate([
      { $match: tf },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          matches: { $sum: "$totalMatches" },
        },
      },
    ]);

    res.json({
      success: true,
      data: { total, totalResults, byType },
    });
  } catch (err) {
    next(err);
  }
}

/* ════════════════════════════════════════════════════════════════════
 * EVALUATION
 * ════════════════════════════════════════════════════════════════════ */

/** POST /policies/:id/evaluate */
export async function evaluatePolicy(req, res, next) {
  try {
    const dryRun = req.body?.dryRun === true;
    const query = { _id: req.params.id, ...tenantFilter(req.user) };
    const policy = await DiscoveryPolicy.findOne(query).lean();
    if (!policy) throw new AppError("Discovery policy not found", 404);

    const ctx = { scopedTenantId: req.user?.tenantId || null };
    const result = await runDiscoveryPolicy(ctx, policy, { dryRun });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/** POST /evaluate-all */
export async function evaluateAll(req, res, next) {
  try {
    const ctx = { scopedTenantId: req.user?.tenantId || null };
    const summary = await runAllDiscoveryPolicies(ctx);
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

/* ════════════════════════════════════════════════════════════════════
 * RESULTS
 * ════════════════════════════════════════════════════════════════════ */

/** GET /results — paginated discovery results */
export async function listResults(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      policyId,
      applicationId,
      entityType,
      search,
    } = req.query;
    const query = { ...tenantFilter(req.user) };

    if (policyId) query.policyId = policyId;
    if (applicationId) query.applicationId = applicationId;
    if (entityType) query.entityType = entityType;
    if (search) {
      query.$or = [
        { entityDisplayName: new RegExp(search, "i") },
        { entityIdentifier: new RegExp(search, "i") },
        { policyName: new RegExp(search, "i") },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      DiscoveryResult.find(query)
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      DiscoveryResult.countDocuments(query),
    ]);

    const needsDescription = items.filter(
      (r) =>
        !r.entityDescription &&
        (r.entityType === "ENTITLEMENT" || r.entityType === "AD_GROUP") &&
        r.applicationId &&
        r.entityId,
    );

    if (needsDescription.length > 0) {
      const appIds = [
        ...new Set(
          needsDescription.map((r) => String(r.applicationId)).filter(Boolean),
        ),
      ];
      const apps = await Application.find({ _id: { $in: appIds } })
        .select("name tenantId")
        .lean();
      const appMetaById = new Map(apps.map((a) => [String(a._id), a]));

      const idsByApp = new Map();
      for (const r of needsDescription) {
        const appId = String(r.applicationId);
        if (!idsByApp.has(appId)) idsByApp.set(appId, []);
        idsByApp.get(appId).push(r.entityId);
      }

      const descByEntityId = new Map();
      await Promise.all(
        [...idsByApp.entries()].map(async ([appId, entityIds]) => {
          const app = appMetaById.get(appId);
          if (!app?.name) return;
          const EntModel = await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);
          const ids = entityIds
            .map((id) =>
              mongoose.Types.ObjectId.isValid(id)
                ? new mongoose.Types.ObjectId(id)
                : id,
            )
            .filter(Boolean);
          if (ids.length === 0) return;
          const ents = await EntModel.find({ _id: { $in: ids } }).lean();
          for (const ent of ents) {
            const desc = extractEntitlementDescription(ent);
            if (desc) descByEntityId.set(String(ent._id), desc);
          }
        }),
      );

      for (const r of items) {
        if (r.entityDescription) continue;
        const desc = descByEntityId.get(String(r.entityId));
        if (desc) r.entityDescription = desc;
      }
    }

    res.json({
      success: true,
      data: {
        items,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /results/summary — dashboard stats */
export async function getResultsSummary(req, res, next) {
  try {
    const tf = tenantFilter(req.user);
    const [totalResults, byType] = await Promise.all([
      DiscoveryResult.countDocuments(tf),
      DiscoveryResult.aggregate([
        { $match: tf },
        { $group: { _id: "$entityType", count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ success: true, data: { totalResults, byType } });
  } catch (err) {
    next(err);
  }
}

/* ════════════════════════════════════════════════════════════════════
 * FIELD DISCOVERY
 * ════════════════════════════════════════════════════════════════════ */

/** GET /fields/:applicationId/:entityType */
export async function getFields(req, res, next) {
  try {
    const { applicationId, entityType } = req.params;
    if (!["USER", "ENTITLEMENT", "AD_GROUP"].includes(entityType)) {
      throw new AppError(
        "entityType must be USER, ENTITLEMENT, or AD_GROUP",
        400,
      );
    }

    // AD_GROUP discovers fields from entitlement data
    const resolvedType = entityType === "AD_GROUP" ? "ENTITLEMENT" : entityType;
    const fields = await getAvailableFields(applicationId, resolvedType);
    res.json({ success: true, data: fields });
  } catch (err) {
    next(err);
  }
}

/* ════════════════════════════════════════════════════════════════════
 * MARK / UNMARK PRIVILEGED
 * ════════════════════════════════════════════════════════════════════ */

/**
 * PUT /results/mark — Mark results as confirmed privileged.
 * Also updates is_privilege / isPrivileged on source entity models.
 */
export async function markResults(req, res, next) {
  try {
    const { resultIds } = req.body;
    if (!Array.isArray(resultIds) || resultIds.length === 0) {
      throw new AppError("resultIds array is required", 400);
    }

    const tf = tenantFilter(req.user);
    const results = await DiscoveryResult.find({
      _id: { $in: resultIds },
      ...tf,
    }).lean();

    if (results.length === 0) {
      throw new AppError("No matching results found", 404);
    }

    // Update reviewStatus on discovery results
    await DiscoveryResult.updateMany(
      { _id: { $in: resultIds }, ...tf },
      {
        $set: {
          reviewStatus: "confirmed",
          reviewedBy: req.user?.id || null,
          reviewedAt: new Date(),
        },
      },
    );

    // Update is_privilege on source entities
    for (const result of results) {
      try {
        if (result.entityType === "USER") {
          // Update Account model
          if (result.entityId) {
            await Account.updateOne(
              { _id: result.entityId },
              { $set: { isPrivileged: true } },
            ).catch(() => {});
          }

          // Also update the dynamic per-app user collection (is_privileged field)
          if (result.entityId && result.applicationId) {
            const app = await Application.findById(result.applicationId)
              .select("name tenantId")
              .lean();
            if (app?.name) {
              const DynUserModel = await getDynamicUserModelForTenantId(
                app.name,
                app.tenantId,
              );
              await DynUserModel.updateOne(
                { _id: result.entityId },
                {
                  $set: {
                    is_privileged: "TRUE",
                    is_privilege: "TRUE",
                    isPrivileged: true,
                  },
                },
              ).catch(() => {});
            }
          }
        } else {
          // ENTITLEMENT or AD_GROUP — update canonical Entitlement model
          const matchNames = [
            result.entityIdentifier,
            result.entityDisplayName,
          ].filter(Boolean);
          if (matchNames.length > 0) {
            await Entitlement.updateMany(
              {
                applicationId: result.applicationId,
                $or: [
                  { entitlementName: { $in: matchNames } },
                  { name: { $in: matchNames } },
                ],
              },
              { $set: { isPrivileged: true } },
            ).catch(() => {});
          }

          // Also update the dynamic entitlement collection (is_privilege field)
          if (result.entityId && result.applicationId) {
            const app = await Application.findById(result.applicationId)
              .select("name tenantId")
              .lean();
            if (app?.name) {
              const DynModel = await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);
              await DynModel.updateOne(
                { _id: result.entityId },
                {
                  $set: {
                    is_privilege: "TRUE",
                    is_privileged: "TRUE",
                    isPrivileged: true,
                  },
                },
              ).catch(() => {});
            }
          }
        }
      } catch {
        // Non-critical: continue with other results
      }
    }

    res.json({
      success: true,
      data: {
        updated: results.length,
        message: `${results.length} entities marked as privileged`,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /results/unmark — Dismiss results (mark as not privileged).
 * Also clears is_privilege / isPrivileged on source entity models.
 */
export async function unmarkResults(req, res, next) {
  try {
    const { resultIds } = req.body;
    if (!Array.isArray(resultIds) || resultIds.length === 0) {
      throw new AppError("resultIds array is required", 400);
    }

    const tf = tenantFilter(req.user);
    const results = await DiscoveryResult.find({
      _id: { $in: resultIds },
      ...tf,
    }).lean();

    if (results.length === 0) {
      throw new AppError("No matching results found", 404);
    }

    // Update reviewStatus on discovery results
    await DiscoveryResult.updateMany(
      { _id: { $in: resultIds }, ...tf },
      {
        $set: {
          reviewStatus: "dismissed",
          reviewedBy: req.user?.id || null,
          reviewedAt: new Date(),
        },
      },
    );

    // Clear is_privilege on source entities
    for (const result of results) {
      try {
        if (result.entityType === "USER") {
          if (result.entityId) {
            await Account.updateOne(
              { _id: result.entityId },
              { $set: { isPrivileged: false } },
            ).catch(() => {});
          }

          // Also update the dynamic per-app user collection (is_privileged field)
          if (result.entityId && result.applicationId) {
            const app = await Application.findById(result.applicationId)
              .select("name tenantId")
              .lean();
            if (app?.name) {
              const DynUserModel = await getDynamicUserModelForTenantId(
                app.name,
                app.tenantId,
              );
              await DynUserModel.updateOne(
                { _id: result.entityId },
                {
                  $set: {
                    is_privileged: "FALSE",
                    is_privilege: "FALSE",
                    isPrivileged: false,
                  },
                },
              ).catch(() => {});
            }
          }
        } else {
          const matchNames = [
            result.entityIdentifier,
            result.entityDisplayName,
          ].filter(Boolean);
          if (matchNames.length > 0) {
            await Entitlement.updateMany(
              {
                applicationId: result.applicationId,
                $or: [
                  { entitlementName: { $in: matchNames } },
                  { name: { $in: matchNames } },
                ],
              },
              { $set: { isPrivileged: false } },
            ).catch(() => {});
          }

          if (result.entityId && result.applicationId) {
            const app = await Application.findById(result.applicationId)
              .select("name tenantId")
              .lean();
            if (app?.name) {
              const DynModel = await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);
              await DynModel.updateOne(
                { _id: result.entityId },
                {
                  $set: {
                    is_privilege: "FALSE",
                    is_privileged: "FALSE",
                    isPrivileged: false,
                  },
                },
              ).catch(() => {});
            }
          }
        }
      } catch {
        // Non-critical: continue with other results
      }
    }

    res.json({
      success: true,
      data: {
        updated: results.length,
        message: `${results.length} entities unmarked`,
      },
    });
  } catch (err) {
    next(err);
  }
}
