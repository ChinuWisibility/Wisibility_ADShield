import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import GovernanceRiskBandSetting, {
  GOVERNANCE_RISK_BAND_METRIC_KEYS,
} from "../../models/report/GovernanceRiskBandSetting.js";
import {
  isApplicationUsingCustomRuleSet,
  resolveEffectiveRiskBand,
} from "../../services/report/reportingRuleSetResolver.js";

const DEFAULT_A = 25;
const DEFAULT_B = 50;
const DEFAULT_C = 75;

/** Infer C when missing or invalid (legacy rows). */
function inferCriticalStartsAtPct(a, b, storedC) {
  const na = Number(a);
  const nb = Number(b);
  const effB = nb >= 100 ? Math.min(98, Math.max(na + 2, 50)) : nb;
  if (storedC != null && Number.isFinite(Number(storedC))) {
    const nc = Number(storedC);
    if (nc > effB && nc <= 99) return nc;
  }
  return Math.min(99, Math.max(effB + 1, Math.round((effB + 100) / 2)));
}

function resolveTenantObjectId(req) {
  const { tenantId: tenantIdQuery } = req.query;
  let tenantId = tenantIdQuery || req.user?.tenantId;
  if (tenantId && typeof tenantId === "object" && tenantId._id) {
    tenantId = tenantId._id;
  }
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    return { error: { status: 400, message: "Valid tenantId is required" } };
  }
  return { tid: new mongoose.Types.ObjectId(String(tenantId)) };
}

function parseMetricKey(raw) {
  const k = String(raw || "orphan_uncorrelated_share").trim();
  if (!GOVERNANCE_RISK_BAND_METRIC_KEYS.includes(k)) {
    return { error: { status: 400, message: `Invalid metricKey. Allowed: ${GOVERNANCE_RISK_BAND_METRIC_KEYS.join(", ")}` } };
  }
  return { metricKey: k };
}

function validateBandsTriple(A, B, C) {
  const a = Math.round(Number(A));
  const b = Math.round(Number(B));
  const cRaw = C == null || C === "" ? null : Number(C);
  const c = cRaw == null || !Number.isFinite(cRaw) ? inferCriticalStartsAtPct(a, b, null) : Math.round(cRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { error: { status: 400, message: "mediumStartsAtPct and highStartsAtPct must be numbers" } };
  }
  if (a < 1 || a > 96 || b < 2 || b > 98 || c < 3 || c > 99) {
    return {
      error: {
        status: 400,
        message: "Boundaries must satisfy 1 ≤ A ≤ 96, A+1 ≤ B ≤ 98, B+1 ≤ C ≤ 99 (Low / Medium / High / Critical)",
      },
    };
  }
  if (a >= b || b >= c) {
    return { error: { status: 400, message: "mediumStartsAtPct < highStartsAtPct < criticalStartsAtPct is required" } };
  }
  return { mediumStartsAtPct: a, highStartsAtPct: b, criticalStartsAtPct: c };
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

/**
 * GET /api/reports/governance-risk-bands/:applicationId?tenantId=&metricKey=
 */
export async function getGovernanceRiskBandSetting(req, res) {
  try {
    const t = resolveTenantObjectId(req);
    if (t.error) return res.status(t.error.status).json({ success: false, message: t.error.message });
    const { tid } = t;

    const mk = parseMetricKey(req.query.metricKey);
    if (mk.error) return res.status(mk.error.status).json({ success: false, message: mk.error.message });
    const { metricKey } = mk;

    const app = await assertApplicationInTenant(tid, req.params.applicationId);
    if (app.error) return res.status(app.error.status).json({ success: false, message: app.error.message });

    const resolved = await resolveEffectiveRiskBand(tid, app.appOid, metricKey);
    return res.status(200).json({
      success: true,
      data: {
        metricKey: resolved.metricKey,
        mediumStartsAtPct: resolved.mediumStartsAtPct,
        highStartsAtPct: resolved.highStartsAtPct,
        criticalStartsAtPct: resolved.criticalStartsAtPct,
        isDefault: !!resolved.isDefault,
        source: resolved.source,
        useCustomRuleSet: resolved.useCustomRuleSet,
        updatedAt: resolved.updatedAt,
      },
    });
  } catch (error) {
    console.error("[getGovernanceRiskBandSetting]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * PUT /api/reports/governance-risk-bands/:applicationId?tenantId=
 * Body: { metricKey?, mediumStartsAtPct, highStartsAtPct, criticalStartsAtPct? }
 */
export async function putGovernanceRiskBandSetting(req, res) {
  try {
    const t = resolveTenantObjectId(req);
    if (t.error) return res.status(t.error.status).json({ success: false, message: t.error.message });
    const { tid } = t;

    const mk = parseMetricKey(req.body?.metricKey ?? req.query.metricKey);
    if (mk.error) return res.status(mk.error.status).json({ success: false, message: mk.error.message });
    const { metricKey } = mk;

    const app = await assertApplicationInTenant(tid, req.params.applicationId);
    if (app.error) return res.status(app.error.status).json({ success: false, message: app.error.message });

    const useCustom = await isApplicationUsingCustomRuleSet(tid, app.appOid);
    if (!useCustom) {
      return res.status(403).json({
        success: false,
        message: "Risk bands are inherited from the tenant global rule set. Enable a custom rule set for this application to edit.",
      });
    }

    const v = validateBandsTriple(
      req.body?.mediumStartsAtPct,
      req.body?.highStartsAtPct,
      req.body?.criticalStartsAtPct,
    );
    if (v.error) return res.status(v.error.status).json({ success: false, message: v.error.message });

    const userId = req.user?._id || req.user?.id;
    const updatedBy = userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : undefined;

    const doc = await GovernanceRiskBandSetting.findOneAndUpdate(
      { tenantId: tid, applicationId: app.appOid, metricKey },
      {
        $set: {
          mediumStartsAtPct: v.mediumStartsAtPct,
          highStartsAtPct: v.highStartsAtPct,
          criticalStartsAtPct: v.criticalStartsAtPct,
          ...(updatedBy ? { updatedBy } : {}),
        },
        $setOnInsert: {
          tenantId: tid,
          applicationId: app.appOid,
          metricKey,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    return res.status(200).json({
      success: true,
      data: {
        metricKey: doc.metricKey,
        mediumStartsAtPct: doc.mediumStartsAtPct,
        highStartsAtPct: doc.highStartsAtPct,
        criticalStartsAtPct: doc.criticalStartsAtPct,
        isDefault: false,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (error) {
    console.error("[putGovernanceRiskBandSetting]", error);
    return res.status(500).json({ success: false, message: error.message });
  }
}
