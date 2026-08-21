import { GOVERNANCE_RISK_BAND_METRIC_KEYS } from "../../models/report/GovernanceRiskBandSetting.js";

export const DEFAULT_RISK_BAND_A = 25;
export const DEFAULT_RISK_BAND_B = 50;
export const DEFAULT_RISK_BAND_C = 75;

export const DEFAULT_ALERT_THRESHOLDS = {
  orphanAccountsMax: 10,
  certCompletionMinPct: 85,
  dormantDays: 90,
  leaverSlaDays: 5,
  privilegedReviewDays: 90,
};

export const DEFAULT_NOTIFICATIONS = {
  notifyEmailAppOwner: true,
  notifyEscalateCiso: true,
  escalateCisoAfterDays: 7,
  notifyWeeklySummary: false,
  notifyAutoDisableDormant: true,
};

function defaultRiskBandTriple() {
  return {
    mediumStartsAtPct: DEFAULT_RISK_BAND_A,
    highStartsAtPct: DEFAULT_RISK_BAND_B,
    criticalStartsAtPct: DEFAULT_RISK_BAND_C,
  };
}

export function cloneDefaultRiskBands() {
  const bands = {};
  for (const key of GOVERNANCE_RISK_BAND_METRIC_KEYS) {
    bands[key] = defaultRiskBandTriple();
  }
  return bands;
}

export function cloneDefaultReportingRuleSet() {
  return {
    alertThresholds: { ...DEFAULT_ALERT_THRESHOLDS },
    notifications: { ...DEFAULT_NOTIFICATIONS },
    riskBands: cloneDefaultRiskBands(),
  };
}

export function mergeReportingRuleSetWithDefaults(stored) {
  const base = cloneDefaultReportingRuleSet();
  if (!stored || typeof stored !== "object") return base;

  const alertThresholds = {
    ...base.alertThresholds,
    ...(stored.alertThresholds && typeof stored.alertThresholds === "object" ? stored.alertThresholds : {}),
  };
  const notifications = {
    ...base.notifications,
    ...(stored.notifications && typeof stored.notifications === "object" ? stored.notifications : {}),
  };
  const riskBands = { ...base.riskBands };
  if (stored.riskBands && typeof stored.riskBands === "object") {
    for (const key of GOVERNANCE_RISK_BAND_METRIC_KEYS) {
      const row = stored.riskBands[key];
      if (row && typeof row === "object") {
        riskBands[key] = {
          ...base.riskBands[key],
          ...row,
        };
      }
    }
  }

  return { alertThresholds, notifications, riskBands };
}

/** Flatten alert + notification fields for export snapshot compatibility. */
export function flattenThresholdsForExport(alertThresholds, notifications) {
  return {
    ...(alertThresholds && typeof alertThresholds === "object" ? alertThresholds : {}),
    ...(notifications && typeof notifications === "object" ? notifications : {}),
  };
}
