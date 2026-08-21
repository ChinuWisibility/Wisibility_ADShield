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

export const DEFAULT_RISK_BAND = {
  mediumStartsAtPct: 25,
  highStartsAtPct: 50,
  criticalStartsAtPct: 75,
};

export const REPORT_METRIC_KEYS = [
  'orphan_uncorrelated_share',
  'active_users_share',
  'inactive_users_share',
  'privileged_users_share',
];

export function cloneDefaultReportingRuleSet() {
  const riskBands = {};
  for (const key of REPORT_METRIC_KEYS) {
    riskBands[key] = { ...DEFAULT_RISK_BAND };
  }
  return {
    alertThresholds: { ...DEFAULT_ALERT_THRESHOLDS },
    notifications: { ...DEFAULT_NOTIFICATIONS },
    riskBands,
  };
}

export function mergeReportingRuleSetConfig(stored) {
  const base = cloneDefaultReportingRuleSet();
  if (!stored || typeof stored !== 'object') return base;

  return {
    alertThresholds: { ...base.alertThresholds, ...(stored.alertThresholds || {}) },
    notifications: { ...base.notifications, ...(stored.notifications || {}) },
    riskBands: REPORT_METRIC_KEYS.reduce((acc, key) => {
      acc[key] = { ...base.riskBands[key], ...(stored.riskBands?.[key] || {}) };
      return acc;
    }, {}),
  };
}

export function flattenThresholdsForExport(alertThresholds, notifications) {
  return { ...(alertThresholds || {}), ...(notifications || {}) };
}
