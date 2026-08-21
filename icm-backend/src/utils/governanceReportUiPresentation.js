/**
 * Labels and layout helpers so PDF/Excel match Iso2007Report.jsx presentation.
 */

export const UI_COPY = {
  platformLine: "ISO/IEC 27001:2022 · IGA Intelligence Platform",
  reportTitle: "Governance Intelligence Report",
  overviewFootnote:
    "Account lifecycle distribution includes import flags and OPEN uncorrelated rows from the correlation engine (same tenant + application).",
  accountStatusTitle: "Account status distribution",
  accountStatusCaption:
    "Standard active vs privileged (warehouse detection), inactive, dormant, and orphan / uncorrelated (import flags plus OPEN correlation queue). Each logical account counted once.",
  complianceTrendTitle: "Compliance score trend",
  complianceTrendCaption:
    "Executive comparison of the previous review versus the current review (governance health 0–100).",
  departmentTitle: "Account status by department",
  departmentCaption:
    "Same buckets as the lifecycle chart — up to 12 rows, sorted by headcount. Queue-only rows may appear under Uncorrelated queue (not in cert. list).",
  controlsHeading: "ISO/IEC 27001:2022 Control Assessment",
  certificationsHeading: "Access certifications (campaign scope)",
  sodHeading: "Segregation of duties (application scope)",
  sodCaption:
    "Policies scoped to this application and their violations (same data as the SOD tab).",
  accountsHeading: "Account scope & evidence",
  thresholdsHeading: "Risk bands",
  thresholdsCaption:
    "Low / Medium / High / Critical band boundaries from the Thresholds tab (tenant or application rule set). Risk alert thresholds and notification escalation are not included (hidden in the UI).",
};

/** @param {string} [status] */
export function controlStatusUiLabel(status) {
  switch (status) {
    case "COMPLIANT":
      return "Compliant";
    case "PARTIAL":
      return "Partial";
    case "NON_COMPLIANT":
      return "Non-Compliant";
    default:
      return "N/A";
  }
}

/** @param {number|null|undefined} riskExposure10 */
export function riskPostureTierLabel(riskExposure10) {
  if (riskExposure10 == null || Number.isNaN(Number(riskExposure10))) return "—";
  const x = Number(riskExposure10);
  if (x <= 3) return "Low risk";
  if (x <= 6) return "Medium risk";
  return "High risk";
}

/** @param {Record<string, number>} accountLifecycleCounts */
export function accountLifecycleTotal(accountLifecycleCounts) {
  if (!accountLifecycleCounts) return 0;
  const a = accountLifecycleCounts;
  return (
    (a.standardActive || 0) +
    (a.privileged || 0) +
    (a.inactive || 0) +
    (a.dormant || 0) +
    (a.orphan || 0)
  );
}

/** @param {{ status?: string }[]} controlRows */
export function controlComplianceSummary(controlRows) {
  const rows = Array.isArray(controlRows) ? controlRows : [];
  const total = rows.length;
  let compliant = 0;
  let partial = 0;
  let nonCompliant = 0;
  let na = 0;
  for (const c of rows) {
    switch (c.status) {
      case "COMPLIANT":
        compliant += 1;
        break;
      case "PARTIAL":
        partial += 1;
        break;
      case "NON_COMPLIANT":
        nonCompliant += 1;
        break;
      default:
        na += 1;
    }
  }
  // Weighted % over applicable controls only (match Iso2007Report / computeIsoCompliancePercent)
  const applicable = compliant + partial + nonCompliant;
  const weighted = applicable > 0 ? (compliant + partial * 0.5) / applicable : 0;
  const pct = applicable > 0 ? Math.round(weighted * 100) : 0;
  return { compliant, partial, nonCompliant, na, total, applicable, pct };
}

/**
 * Posture progress rows (same metrics as Overview risk card, Iso2007Report).
 * @param {{ overview?: object, controls?: { rows?: object[] } }} snapshot
 */
export function buildPostureProgressRows(snapshot) {
  const { overview, controls } = snapshot;
  const k = overview?.kpis || {};
  const ac = overview?.accountLifecycleCounts || {};
  const totalUsers = Math.max(0, Number(k.totalUsers) || 0);
  const donutTotal = accountLifecycleTotal(ac);
  const priv = Math.max(0, Number(k.privilegedAccounts) || 0);
  const summary = controlComplianceSummary(controls?.rows || []);

  const activePct = totalUsers > 0 ? Math.round((k.activeUsers / totalUsers) * 100) : 0;
  const inactivePct = totalUsers > 0 ? Math.round((k.inactiveUsers / totalUsers) * 100) : 0;
  const orphanPct =
    donutTotal > 0 ? Math.min(100, Math.round(((ac.orphan || 0) / donutTotal) * 100)) : 0;
  const privPct = totalUsers > 0 ? Math.min(100, Math.round((priv / totalUsers) * 100)) : 0;

  return [
    { label: "Active population", pct: activePct },
    { label: "Inactive accounts", pct: inactivePct },
    { label: "Orphan / uncorrelated", pct: orphanPct },
    { label: "Privileged share", pct: privPct },
    { label: "ISO controls score", pct: summary.pct },
  ];
}

/** Thresholds tab field labels (alert / notification — kept for legacy callers). */
export const THRESHOLD_UI_LABELS = {
  orphanAccountsMax: "Orphan accounts — alert above (count)",
  certCompletionMinPct: "Cert completion — warn below (%)",
  dormantDays: "Dormant account age — flag after (days)",
  leaverSlaDays: "Leaver deprovisioning SLA (days)",
  privilegedReviewDays: "Privileged account review cycle (days)",
  notifyEmailAppOwner: "Email alerts to application owner on threshold breach",
  notifyEscalateCiso: "Escalate to CISO if unresolved after configured days",
  escalateCisoAfterDays: "Escalate to CISO after (days)",
  notifyWeeklySummary: "Weekly summary report to stakeholders",
  notifyAutoDisableDormant: "Auto-disable accounts exceeding dormancy threshold",
};

export function thresholdRowsForExport(thresholds) {
  const th = thresholds && typeof thresholds === "object" ? thresholds : {};
  return Object.entries(th).map(([key, val]) => [
    THRESHOLD_UI_LABELS[key] || key,
    val == null ? "" : String(val),
  ]);
}

export const RISK_BAND_UI_LABELS = {
  orphan_uncorrelated_share: "Orphan uncorrelated — risk bands",
  active_users_share: "Active users — coverage bands",
  inactive_users_share: "Inactive users — risk bands",
  privileged_users_share: "Privileged users — risk bands",
};

/**
 * Rows for PDF/Excel Thresholds tab — risk band boundaries only.
 * @param {Record<string, { mediumStartsAtPct?: number, highStartsAtPct?: number, criticalStartsAtPct?: number }>|null|undefined} riskBands
 * @returns {string[][]}
 */
export function riskBandRowsForExport(riskBands) {
  const bands = riskBands && typeof riskBands === "object" ? riskBands : {};
  const keys = Object.keys(RISK_BAND_UI_LABELS);
  const rows = [];
  for (const key of keys) {
    const band = bands[key];
    if (!band || typeof band !== "object") continue;
    const a = Number(band.mediumStartsAtPct);
    const b = Number(band.highStartsAtPct);
    const c = Number(band.criticalStartsAtPct);
    if (![a, b, c].every((n) => Number.isFinite(n))) continue;
    const fmt = (n) => `${Number(n).toFixed(n % 1 === 0 ? 0 : 1)}%`;
    rows.push([
      RISK_BAND_UI_LABELS[key] || key,
      `< ${fmt(a)}`,
      fmt(a),
      fmt(b),
      `≥ ${fmt(c)}`,
      `Low < ${fmt(a)} · Medium ${fmt(a)}–${fmt(b)} · High ${fmt(b)}–${fmt(c)} · Critical ≥ ${fmt(c)}`,
    ]);
  }
  return rows;
}
