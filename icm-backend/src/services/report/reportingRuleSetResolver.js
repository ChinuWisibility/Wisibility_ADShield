import mongoose from "mongoose";
import ReportingRuleSet from "../../models/report/ReportingRuleSet.js";
import ApplicationReportingRuleOverride from "../../models/report/ApplicationReportingRuleOverride.js";
import GovernanceRiskBandSetting, {
  GOVERNANCE_RISK_BAND_METRIC_KEYS,
} from "../../models/report/GovernanceRiskBandSetting.js";
import {
  cloneDefaultReportingRuleSet,
  mergeReportingRuleSetWithDefaults,
  DEFAULT_RISK_BAND_A,
  DEFAULT_RISK_BAND_B,
  DEFAULT_RISK_BAND_C,
} from "./reportingRuleSetDefaults.js";

const INHERITED_FROM_PATH = "/org-admin/global-rule-set/reporting";

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

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

/**
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @returns {Promise<{ config: object, source: 'tenant' | 'default' }>}
 */
export async function resolveTenantReportingRuleSet(tenantId) {
  const tid = toObjectId(tenantId);
  if (!tid) {
    return { config: cloneDefaultReportingRuleSet(), source: "default" };
  }

  const doc = await ReportingRuleSet.findOne({ tenantId: tid, isActive: true }).lean();
  if (!doc) {
    return { config: cloneDefaultReportingRuleSet(), source: "default" };
  }

  return {
    config: mergeReportingRuleSetWithDefaults({
      alertThresholds: doc.alertThresholds,
      notifications: doc.notifications,
      riskBands: doc.riskBands,
    }),
    source: "tenant",
    version: doc.version ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

/**
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {string|import('mongoose').Types.ObjectId} applicationId
 */
export async function getApplicationOverride(tenantId, applicationId) {
  const tid = toObjectId(tenantId);
  const aid = toObjectId(applicationId);
  if (!tid || !aid) return null;
  return ApplicationReportingRuleOverride.findOne({ tenantId: tid, applicationId: aid }).lean();
}

/**
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {string|import('mongoose').Types.ObjectId} applicationId
 */
export async function resolveEffectiveReportingRuleSet(tenantId, applicationId) {
  const { config: globalConfig, source: globalSource } = await resolveTenantReportingRuleSet(tenantId);
  const override = await getApplicationOverride(tenantId, applicationId);

  if (!override?.useCustomRuleSet) {
    return {
      alertThresholds: { ...globalConfig.alertThresholds },
      notifications: { ...globalConfig.notifications },
      riskBands: { ...globalConfig.riskBands },
      useCustomRuleSet: false,
      source: globalSource === "tenant" ? "tenant" : "default",
      inheritedFrom: INHERITED_FROM_PATH,
    };
  }

  const alertThresholds = {
    ...globalConfig.alertThresholds,
    ...(override.alertThresholds && typeof override.alertThresholds === "object" ? override.alertThresholds : {}),
  };
  const notifications = {
    ...globalConfig.notifications,
    ...(override.notifications && typeof override.notifications === "object" ? override.notifications : {}),
  };

  return {
    alertThresholds,
    notifications,
    riskBands: { ...globalConfig.riskBands },
    useCustomRuleSet: true,
    source: "application",
    inheritedFrom: null,
  };
}

/**
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {string|import('mongoose').Types.ObjectId} applicationId
 * @param {string} metricKey
 */
export async function resolveEffectiveRiskBand(tenantId, applicationId, metricKey) {
  const key = GOVERNANCE_RISK_BAND_METRIC_KEYS.includes(metricKey)
    ? metricKey
    : GOVERNANCE_RISK_BAND_METRIC_KEYS[0];

  const { config: globalConfig } = await resolveTenantReportingRuleSet(tenantId);
  const override = await getApplicationOverride(tenantId, applicationId);
  const globalBand = globalConfig.riskBands?.[key] || {
    mediumStartsAtPct: DEFAULT_RISK_BAND_A,
    highStartsAtPct: DEFAULT_RISK_BAND_B,
    criticalStartsAtPct: DEFAULT_RISK_BAND_C,
  };

  if (!override?.useCustomRuleSet) {
    return {
      metricKey: key,
      mediumStartsAtPct: globalBand.mediumStartsAtPct,
      highStartsAtPct: globalBand.highStartsAtPct,
      criticalStartsAtPct: inferCriticalStartsAtPct(
        globalBand.mediumStartsAtPct,
        globalBand.highStartsAtPct,
        globalBand.criticalStartsAtPct,
      ),
      isDefault: false,
      source: "tenant",
      useCustomRuleSet: false,
    };
  }

  const tid = toObjectId(tenantId);
  const aid = toObjectId(applicationId);
  const doc = await GovernanceRiskBandSetting.findOne({
    tenantId: tid,
    applicationId: aid,
    metricKey: key,
  }).lean();

  if (!doc) {
    return {
      metricKey: key,
      mediumStartsAtPct: globalBand.mediumStartsAtPct,
      highStartsAtPct: globalBand.highStartsAtPct,
      criticalStartsAtPct: inferCriticalStartsAtPct(
        globalBand.mediumStartsAtPct,
        globalBand.highStartsAtPct,
        globalBand.criticalStartsAtPct,
      ),
      isDefault: true,
      source: "application",
      useCustomRuleSet: true,
    };
  }

  return {
    metricKey: doc.metricKey,
    mediumStartsAtPct: doc.mediumStartsAtPct,
    highStartsAtPct: doc.highStartsAtPct,
    criticalStartsAtPct: inferCriticalStartsAtPct(
      doc.mediumStartsAtPct,
      doc.highStartsAtPct,
      doc.criticalStartsAtPct,
    ),
    isDefault: false,
    source: "application",
    useCustomRuleSet: true,
    updatedAt: doc.updatedAt,
  };
}

export async function isApplicationUsingCustomRuleSet(tenantId, applicationId) {
  const override = await getApplicationOverride(tenantId, applicationId);
  return !!override?.useCustomRuleSet;
}
