import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import Tenant from "../../models/platform/Tenant.js";
import User from "../../models/platform/User.js";
import ReportingRuleSet from "../../models/report/ReportingRuleSet.js";
import ApplicationReportingRuleOverride from "../../models/report/ApplicationReportingRuleOverride.js";
import { GOVERNANCE_RISK_BAND_METRIC_KEYS } from "../../models/report/GovernanceRiskBandSetting.js";
import {
  cloneDefaultReportingRuleSet,
  mergeReportingRuleSetWithDefaults,
} from "../../services/report/reportingRuleSetDefaults.js";
import {
  resolveEffectiveReportingRuleSet,
  resolveTenantReportingRuleSet,
} from "../../services/report/reportingRuleSetResolver.js";
import { AppError } from "../../middleware/errorHandler.js";

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
    throw new AppError("Tenant context required", 403, "TENANT_REQUIRED");
  }
  return tenantId;
}

function resolveTenantObjectIdFromQuery(req) {
  const { tenantId: tenantIdQuery } = req.query;
  let tenantId = tenantIdQuery || req.user?.tenantId || req.scopedTenantId;
  if (tenantId && typeof tenantId === "object" && tenantId._id) {
    tenantId = tenantId._id;
  }
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    return { error: { status: 400, message: "Valid tenantId is required" } };
  }
  return { tid: new mongoose.Types.ObjectId(String(tenantId)) };
}

async function assertApplicationInTenant(tid, applicationId) {
  if (!applicationId || !mongoose.Types.ObjectId.isValid(String(applicationId))) {
    return { error: { status: 400, message: "Valid applicationId is required" } };
  }
  const appOid = new mongoose.Types.ObjectId(String(applicationId));
  const application = await Application.findById(appOid).select("name tenantId").lean();
  if (!application?.name) {
    return { error: { status: 404, message: "Application not found" } };
  }
  if (String(application.tenantId) !== String(tid)) {
    return { error: { status: 403, message: "Application not in tenant scope" } };
  }
  return { appOid };
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function validateRiskBandTriple(row) {
  if (!row || typeof row !== "object") return null;
  const a = clampInt(row.mediumStartsAtPct, 1, 96, 25);
  let b = clampInt(row.highStartsAtPct, 2, 98, 50);
  let c = clampInt(row.criticalStartsAtPct, 3, 99, 75);
  if (a >= b) b = Math.min(98, a + 1);
  if (b >= c) c = Math.min(99, b + 1);
  if (a >= b || b >= c) return null;
  return { mediumStartsAtPct: a, highStartsAtPct: b, criticalStartsAtPct: c };
}

export function normalizeIncomingReportingRuleSet(body) {
  const base = cloneDefaultReportingRuleSet();
  const src = body?.config && typeof body.config === "object" ? body.config : body;

  const alertThresholds = {
    ...base.alertThresholds,
    ...(src.alertThresholds && typeof src.alertThresholds === "object" ? src.alertThresholds : {}),
  };
  alertThresholds.orphanAccountsMax = clampInt(alertThresholds.orphanAccountsMax, 0, 100, base.alertThresholds.orphanAccountsMax);
  alertThresholds.certCompletionMinPct = clampInt(alertThresholds.certCompletionMinPct, 50, 100, base.alertThresholds.certCompletionMinPct);
  alertThresholds.dormantDays = clampInt(alertThresholds.dormantDays, 30, 365, base.alertThresholds.dormantDays);
  alertThresholds.leaverSlaDays = clampInt(alertThresholds.leaverSlaDays, 1, 30, base.alertThresholds.leaverSlaDays);
  alertThresholds.privilegedReviewDays = clampInt(alertThresholds.privilegedReviewDays, 30, 365, base.alertThresholds.privilegedReviewDays);

  const notifications = {
    ...base.notifications,
    ...(src.notifications && typeof src.notifications === "object" ? src.notifications : {}),
  };
  notifications.notifyEmailAppOwner = !!notifications.notifyEmailAppOwner;
  notifications.notifyEscalateCiso = !!notifications.notifyEscalateCiso;
  notifications.notifyWeeklySummary = !!notifications.notifyWeeklySummary;
  notifications.notifyAutoDisableDormant = !!notifications.notifyAutoDisableDormant;
  notifications.escalateCisoAfterDays = clampInt(notifications.escalateCisoAfterDays, 1, 30, base.notifications.escalateCisoAfterDays);

  const riskBands = { ...base.riskBands };
  if (src.riskBands && typeof src.riskBands === "object") {
    for (const key of GOVERNANCE_RISK_BAND_METRIC_KEYS) {
      const validated = validateRiskBandTriple(src.riskBands[key]);
      if (validated) riskBands[key] = validated;
    }
  }

  return { alertThresholds, notifications, riskBands };
}

function packTenantResponse(tenantId, config, meta = {}) {
  return {
    success: true,
    data: {
      source: meta.source || "tenant",
      config,
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

/** GET /api/org-admin/reporting-rule-set */
export async function getTenantReportingRuleSet(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const { config, source, version, updatedAt } = await resolveTenantReportingRuleSet(tenantId);
    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const doc = await ReportingRuleSet.findOne({ tenantId: tenantObjectId, isActive: true }).lean();

    return res.json(
      packTenantResponse(tenantId, config, {
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

/** PUT /api/org-admin/reporting-rule-set */
export async function putTenantReportingRuleSet(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const config = mergeReportingRuleSetWithDefaults(normalizeIncomingReportingRuleSet(req.body));
    const tenant = await Tenant.findById(tenantId).select("name").lean();
    const userId = req.user?.id || req.user?._id;
    const userName = await resolveUserDisplayName(userId);
    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const existing = await ReportingRuleSet.findOne({ tenantId: tenantObjectId });
    const nextVersion = (existing?.version || 0) + 1;

    const update = {
      tenantId: tenantObjectId,
      tenantName: tenant?.name || "",
      alertThresholds: config.alertThresholds,
      notifications: config.notifications,
      riskBands: config.riskBands,
      isActive: true,
      version: nextVersion,
      updatedBy: userId,
      updatedByName: userName,
    };

    let doc;
    if (existing) {
      doc = await ReportingRuleSet.findOneAndUpdate(
        { tenantId: tenantObjectId },
        { $set: update },
        { new: true },
      ).lean();
    } else {
      const created = await ReportingRuleSet.create({
        ...update,
        createdBy: userId,
        createdByName: userName,
      });
      doc = created.toObject ? created.toObject() : created;
    }

    return res.json(
      packTenantResponse(tenantId, config, {
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

/** DELETE /api/org-admin/reporting-rule-set */
export async function deleteTenantReportingRuleSet(req, res) {
  try {
    const tenantId = requireTenantId(req);
    await ReportingRuleSet.deleteOne({ tenantId: new mongoose.Types.ObjectId(String(tenantId)) });
    const config = cloneDefaultReportingRuleSet();
    return res.json({
      success: true,
      data: { source: "default", config },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

/** GET /api/reports/reporting-rule-set/:applicationId */
export async function getEffectiveReportingRuleSet(req, res) {
  try {
    const t = resolveTenantObjectIdFromQuery(req);
    if (t.error) return res.status(t.error.status).json({ success: false, message: t.error.message });
    const { tid } = t;

    const app = await assertApplicationInTenant(tid, req.params.applicationId);
    if (app.error) return res.status(app.error.status).json({ success: false, message: app.error.message });

    const effective = await resolveEffectiveReportingRuleSet(tid, app.appOid);
    return res.json({
      success: true,
      data: {
        ...effective,
        tenantId: String(tid),
        applicationId: String(app.appOid),
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

/** PUT /api/reports/reporting-rule-set/:applicationId */
export async function putApplicationReportingRuleSet(req, res) {
  try {
    const t = resolveTenantObjectIdFromQuery(req);
    if (t.error) return res.status(t.error.status).json({ success: false, message: t.error.message });
    const { tid } = t;

    const app = await assertApplicationInTenant(tid, req.params.applicationId);
    if (app.error) return res.status(app.error.status).json({ success: false, message: app.error.message });

    const userId = req.user?._id || req.user?.id;
    const updatedBy = userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : undefined;

    const useCustomRuleSet = req.body?.useCustomRuleSet;

    if (useCustomRuleSet === false) {
      await ApplicationReportingRuleOverride.deleteOne({
        tenantId: tid,
        applicationId: app.appOid,
      });
      const effective = await resolveEffectiveReportingRuleSet(tid, app.appOid);
      return res.json({
        success: true,
        data: {
          ...effective,
          tenantId: String(tid),
          applicationId: String(app.appOid),
        },
      });
    }

    const normalized = normalizeIncomingReportingRuleSet(req.body);
    const setFields = {
      useCustomRuleSet: useCustomRuleSet !== undefined ? !!useCustomRuleSet : true,
      alertThresholds: normalized.alertThresholds,
      notifications: normalized.notifications,
      ...(updatedBy ? { updatedBy } : {}),
    };

    await ApplicationReportingRuleOverride.findOneAndUpdate(
      { tenantId: tid, applicationId: app.appOid },
      {
        $set: setFields,
        $setOnInsert: { tenantId: tid, applicationId: app.appOid },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const effective = await resolveEffectiveReportingRuleSet(tid, app.appOid);
    return res.json({
      success: true,
      data: {
        ...effective,
        tenantId: String(tid),
        applicationId: String(app.appOid),
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

/** PUT /api/org-admin/reporting-rule-set/risk-bands/:metricKey — tenant risk band single metric */
export async function putTenantRiskBand(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const metricKey = String(req.params.metricKey || "").trim();
    if (!GOVERNANCE_RISK_BAND_METRIC_KEYS.includes(metricKey)) {
      return res.status(400).json({ success: false, message: `Invalid metricKey: ${metricKey}` });
    }

    const validated = validateRiskBandTriple(req.body);
    if (!validated) {
      return res.status(400).json({ success: false, message: "Invalid risk band boundaries" });
    }

    const { config, source } = await resolveTenantReportingRuleSet(tenantId);
    const nextConfig = {
      ...config,
      riskBands: {
        ...config.riskBands,
        [metricKey]: validated,
      },
    };

    req.body = { config: nextConfig };
    return putTenantReportingRuleSet(req, res);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

/** GET /api/org-admin/reporting-rule-set/risk-bands/:metricKey */
export async function getTenantRiskBand(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const metricKey = String(req.params.metricKey || "").trim();
    if (!GOVERNANCE_RISK_BAND_METRIC_KEYS.includes(metricKey)) {
      return res.status(400).json({ success: false, message: `Invalid metricKey: ${metricKey}` });
    }

    const { config, source } = await resolveTenantReportingRuleSet(tenantId);
    const band = config.riskBands?.[metricKey];
    return res.json({
      success: true,
      data: {
        metricKey,
        ...band,
        isDefault: source === "default",
        source,
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}
