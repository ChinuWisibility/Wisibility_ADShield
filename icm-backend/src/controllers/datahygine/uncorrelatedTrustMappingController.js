import mongoose from "mongoose";
import Tenant from "../../models/platform/Tenant.js";
import User from "../../models/platform/User.js";
import UncorrelatedTrustMappingRuleSet from "../../models/identity/UncorrelatedTrustMappingRuleSet.js";
import {
  cloneDefaultUncorrelatedTrustMappingConfig,
  mergeUncorrelatedTrustMappingWithDefaults,
  TRUST_LEVELS,
  TRUST_SCENARIO_KEYS,
  TRUST_SCENARIO_LABELS,
} from "../../services/datahygine/uncorrelatedTrustMappingDefaults.js";
import {
  invalidateUncorrelatedTrustMappingCache,
  resolveUncorrelatedTrustMapping,
} from "../../services/datahygine/uncorrelatedTrustMappingResolver.js";

async function resolveUserDisplayName(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return "Unknown";
  const u = await User.findById(userId).select("email firstName lastName").lean();
  if (!u) return "Unknown";
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email || "Unknown";
}

function requireTenantId(req) {
  const tenantId = req.scopedTenantId;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    const err = new Error("Tenant context required");
    err.statusCode = 403;
    throw err;
  }
  return tenantId;
}

export function normalizeIncomingUncorrelatedTrustMapping(body) {
  const src = body?.config && typeof body.config === "object" ? body.config : body;
  const base = cloneDefaultUncorrelatedTrustMappingConfig();
  if (!src || typeof src !== "object") return base;

  const useDefaultTrustMapping =
    src.useDefaultTrustMapping !== undefined
      ? Boolean(src.useDefaultTrustMapping)
      : true;

  const srcMapping = src.mapping && typeof src.mapping === "object" ? src.mapping : {};
  const mapping = { ...base.mapping };
  for (const key of TRUST_SCENARIO_KEYS) {
    const level = String(srcMapping[key] || "").trim().toUpperCase();
    mapping[key] = TRUST_LEVELS.includes(level) ? level : base.mapping[key];
  }

  return mergeUncorrelatedTrustMappingWithDefaults({
    useDefaultTrustMapping,
    mapping,
  });
}

function packResponse(tenantId, config, meta = {}) {
  return {
    success: true,
    data: {
      source: meta.source || "tenant",
      config,
      scenarios: TRUST_SCENARIO_KEYS.map((key) => ({
        key,
        label: TRUST_SCENARIO_LABELS[key],
        trustLevel: config.mapping[key],
      })),
      tenantId: String(tenantId),
      tenantName: meta.tenantName ?? null,
      version: meta.version ?? null,
      createdBy: meta.createdBy ?? null,
      createdByName: meta.createdByName ?? null,
      updatedBy: meta.updatedBy ?? null,
      updatedByName: meta.updatedByName ?? null,
      createdAt: meta.createdAt ?? null,
      updatedAt: meta.updatedAt ?? null,
    },
  };
}

/** GET /api/org-admin/uncorrelated-trust-mapping */
export async function getUncorrelatedTrustMapping(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const { config, source, version, updatedAt } = await resolveUncorrelatedTrustMapping(tenantId);
    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const doc = await UncorrelatedTrustMappingRuleSet.findOne({
      tenantId: tenantObjectId,
      isActive: true,
    }).lean();

    return res.json(
      packResponse(tenantId, config, {
        source,
        tenantName: doc?.tenantName || null,
        version: doc?.version ?? version ?? null,
        createdBy: doc?.createdBy ? String(doc.createdBy) : null,
        createdByName: doc?.createdByName || null,
        updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
        updatedByName: doc?.updatedByName || null,
        createdAt: doc?.createdAt || null,
        updatedAt: doc?.updatedAt || updatedAt || null,
      }),
    );
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

/** PUT /api/org-admin/uncorrelated-trust-mapping */
export async function putUncorrelatedTrustMapping(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const config = normalizeIncomingUncorrelatedTrustMapping(req.body);
    const tenant = await Tenant.findById(tenantId).select("name").lean();
    const userId = req.user?.id || req.user?._id;
    const userName = await resolveUserDisplayName(userId);
    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const existing = await UncorrelatedTrustMappingRuleSet.findOne({ tenantId: tenantObjectId });
    const nextVersion = (existing?.version || 0) + 1;

    const update = {
      tenantId: tenantObjectId,
      tenantName: tenant?.name || "",
      config,
      isActive: true,
      version: nextVersion,
      updatedBy: userId,
      updatedByName: userName,
    };

    let doc;
    if (existing) {
      doc = await UncorrelatedTrustMappingRuleSet.findOneAndUpdate(
        { tenantId: tenantObjectId },
        { $set: update },
        { new: true },
      ).lean();
    } else {
      const created = await UncorrelatedTrustMappingRuleSet.create({
        ...update,
        createdBy: userId,
        createdByName: userName,
      });
      doc = created.toObject ? created.toObject() : created;
    }

    invalidateUncorrelatedTrustMappingCache(tenantId);

    return res.json(
      packResponse(tenantId, config, {
        source: "tenant",
        tenantName: doc.tenantName,
        version: doc.version,
        createdBy: doc.createdBy ? String(doc.createdBy) : null,
        createdByName: doc.createdByName,
        updatedBy: doc.updatedBy ? String(doc.updatedBy) : null,
        updatedByName: doc.updatedByName,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }),
    );
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

/** DELETE /api/org-admin/uncorrelated-trust-mapping — reset to defaults */
export async function deleteUncorrelatedTrustMapping(req, res) {
  try {
    const tenantId = requireTenantId(req);
    await UncorrelatedTrustMappingRuleSet.deleteOne({
      tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    });
    invalidateUncorrelatedTrustMappingCache(tenantId);
    const config = cloneDefaultUncorrelatedTrustMappingConfig();
    return res.json({
      success: true,
      data: {
        source: "default",
        config,
        scenarios: TRUST_SCENARIO_KEYS.map((key) => ({
          key,
          label: TRUST_SCENARIO_LABELS[key],
          trustLevel: config.mapping[key],
        })),
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}
