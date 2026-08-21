/**
 * Maps Compare API output into a Data-Hygiene-like remediation summary.
 * Does not invent a second comparison algorithm — delegates to compareSecurityScans.
 */
import Application from "../../models/application/Application.js";
import { listScanResultsForApplication } from "../posture/postureScanResultsStore.js";
import { compareSecurityScans } from "./securityFindingsService.js";

/** Mirrors frontend SCAN_CENTER_CATEGORIES / SCAN_CENTER_CATEGORY_FEATURES. */
export const REMEDIATION_FEATURE_CATEGORIES = [
  {
    id: "user_security",
    label: "User Account Security",
    features: [
      "disabled_users",
      "inactive_users",
      "locked_accounts",
      "password_never_expires",
      "password_not_required",
      "reversible_encryption_enabled",
      "smartcard_not_required",
      "service_accounts",
    ],
  },
  {
    id: "privileged_access",
    label: "Privileged Access",
    features: [
      "nested_privileged_access",
      "dormant_privileged_users",
      "excessive_privileges",
      "privilege_escalation_paths",
    ],
  },
  {
    id: "group_security",
    label: "Group Intelligence",
    features: [
      "empty_groups",
      "groups_without_owners",
      "nested_groups",
      "circular_memberships",
      "unused_groups",
      "orphan_groups",
      "duplicate_groups",
      "toxic_privilege_combinations",
    ],
  },
  {
    id: "kerberos_security",
    label: "Kerberos Security",
    features: [
      "kerberoastable_accounts",
      "asrep_roastable_users",
      "preauth_disabled",
      "spn_misconfigurations",
      "unconstrained_delegation",
      "constrained_delegation",
      "rbcd",
    ],
  },
  {
    id: "acl_intelligence",
    label: "SID & ACL Intelligence",
    features: [
      "orphan_sids",
      "shadow_admins",
      "sid_history_analysis",
      "foreign_security_principals",
      "unknown_sid_bindings",
      "broken_acls",
    ],
  },
  {
    id: "computer_security",
    label: "Computer Security",
    features: [
      "disabled_computers",
      "inactive_computers",
      "missing_os_information",
      "unsupported_os_versions",
      "servers_in_wrong_ou",
      "duplicate_spns",
      "computers_without_owners",
    ],
  },
];

const FEATURE_LABELS = {
  empty_groups: "Empty groups",
  groups_without_owners: "Groups without owners",
  nested_groups: "Nested groups",
  circular_memberships: "Circular membership",
  unused_groups: "Unused groups",
  orphan_groups: "Orphan groups",
  duplicate_groups: "Duplicate groups",
  toxic_privilege_combinations: "Toxic privilege combinations",
  nested_privileged_access: "Nested privileged access",
  dormant_privileged_users: "Dormant privileged users",
  excessive_privileges: "Excessive privileges",
  privilege_escalation_paths: "Privilege escalation paths",
  orphan_sids: "Orphan SIDs",
  shadow_admins: "Shadow admins",
  sid_history_analysis: "SID history analysis",
  foreign_security_principals: "Foreign security principals",
  unknown_sid_bindings: "Unknown SID bindings",
  broken_acls: "Broken ACLs",
  disabled_users: "Disabled users",
  inactive_users: "Inactive users",
  locked_accounts: "Locked accounts",
  password_never_expires: "Password never expires",
  password_not_required: "Password not required",
  reversible_encryption_enabled: "Reversible encryption",
  smartcard_not_required: "Smartcard not required",
  service_accounts: "Service accounts",
  disabled_computers: "Disabled computers",
  inactive_computers: "Inactive computers",
  missing_os_information: "Missing OS information",
  unsupported_os_versions: "Unsupported OS versions",
  servers_in_wrong_ou: "Servers in wrong OU",
  duplicate_spns: "Duplicate SPNs",
  computers_without_owners: "Computers without owners",
  kerberoastable_accounts: "Kerberoastable accounts",
  asrep_roastable_users: "AS-REP roastable users",
  preauth_disabled: "Pre-auth disabled",
  spn_misconfigurations: "SPN misconfigurations",
  unconstrained_delegation: "Unconstrained delegation",
  constrained_delegation: "Constrained delegation",
  rbcd: "Resource-based constrained delegation",
};

export function featureLabel(featureKey) {
  const key = String(featureKey || "");
  return FEATURE_LABELS[key] || key.replace(/_/g, " ");
}

function progressTone(percent) {
  if (percent >= 70) return "ok";
  if (percent >= 30) return "active";
  return "fail";
}

/**
 * Build hygiene-like widgets + progress from a compare payload.
 */
export function mapCompareToRemediationSummary(compare, { applicationId, applicationName } = {}) {
  const byFeature = compare?.byFeature || {};
  const featureKeys = Object.keys(byFeature).sort();

  const widgets = featureKeys.map((featureKey) => {
    const b = byFeature[featureKey] || {};
    const progress = Number(b.progressPercent) || 0;
    return {
      id: featureKey,
      themeKey: featureKey,
      title: featureLabel(featureKey),
      tip: `Baseline ${b.baseline || 0} · Current ${b.current || 0} · Progress ${progress}%`,
      percentLabel: "Progress",
      primaryColumnLabel: "Status",
      countColumnLabel: "Findings",
      applicationId: applicationId || null,
      baseline: b.baseline || 0,
      current: b.current || 0,
      resolved: b.resolved || 0,
      remaining: b.remaining || 0,
      new: b.new || 0,
      reopened: b.reopened || 0,
      progressPercent: progress,
      rows: [
        {
          label: "Resolved",
          count: b.resolved || 0,
          percent: progress,
          applicationId,
          detailWidgetId: featureKey,
        },
        {
          label: "Remaining",
          count: b.remaining || 0,
          percent: b.baseline ? Math.round(((b.remaining || 0) / b.baseline) * 100) : 0,
          applicationId,
          detailWidgetId: featureKey,
        },
        {
          label: "New",
          count: b.new || 0,
          percent: 0,
          applicationId,
          detailWidgetId: featureKey,
        },
      ],
    };
  });

  const categoryWidgets = REMEDIATION_FEATURE_CATEGORIES.map((cat) => {
    const agg = { baseline: 0, current: 0, resolved: 0, remaining: 0, new: 0, reopened: 0 };
    const rows = [];
    for (const featureKey of cat.features) {
      const b = byFeature[featureKey];
      if (!b) continue;
      agg.baseline += b.baseline || 0;
      agg.current += b.current || 0;
      agg.resolved += b.resolved || 0;
      agg.remaining += b.remaining || 0;
      agg.new += b.new || 0;
      agg.reopened += b.reopened || 0;
      rows.push({
        label: featureLabel(featureKey),
        count: b.remaining || 0,
        percent: Number(b.progressPercent) || 0,
        applicationId,
        detailWidgetId: featureKey,
      });
    }
    const progressPercent =
      agg.baseline > 0 ? Math.round((agg.resolved / agg.baseline) * 100) : 0;
    if (!rows.length && !agg.baseline && !agg.current) return null;
    return {
      id: cat.id,
      themeKey: cat.id,
      title: cat.label,
      tip: `Category rollup · Baseline ${agg.baseline} · Progress ${progressPercent}%`,
      percentLabel: "Progress",
      primaryColumnLabel: "Feature",
      countColumnLabel: "Remaining",
      applicationId: applicationId || null,
      ...agg,
      progressPercent,
      rows,
    };
  }).filter(Boolean);

  const progress = {
    baselineFindings: compare?.baselineFindings ?? 0,
    currentFindings: compare?.currentFindings ?? 0,
    resolved: compare?.resolved ?? 0,
    remaining: compare?.remaining ?? compare?.unchanged ?? 0,
    new: compare?.new ?? 0,
    reopened: compare?.reopened ?? 0,
    progressPercent: compare?.progressPercent ?? 0,
    tone: progressTone(compare?.progressPercent ?? 0),
  };

  const applicationTiles = [
    {
      id: `application:${applicationId || "unknown"}`,
      applicationId: applicationId || null,
      themeKey: "_application",
      title: applicationName || "Application",
      percentLabel: "Progress",
      primaryColumnLabel: "Feature",
      countColumnLabel: "Remaining",
      tip: `Overall remediation progress ${progress.progressPercent}%`,
      progressPercent: progress.progressPercent,
      baseline: progress.baselineFindings,
      current: progress.currentFindings,
      resolved: progress.resolved,
      remaining: progress.remaining,
      new: progress.new,
      rows: widgets.map((w) => ({
        label: w.title,
        count: w.remaining || 0,
        percent: w.progressPercent || 0,
        applicationId,
        detailWidgetId: w.id,
      })),
    },
  ];

  return {
    progress,
    pair: {
      baselineScanId: compare?.leftScanId || null,
      currentScanId: compare?.rightScanId || null,
      baselineCompletedAt: compare?.leftCompletedAt || null,
      currentCompletedAt: compare?.rightCompletedAt || null,
      lastComparedAt: new Date().toISOString(),
    },
    message: compare?.message || null,
    widgets,
    categoryWidgets,
    applicationTiles,
    byFeature,
  };
}

/**
 * Application-scoped remediation summary (baseline vs current assessments).
 */
/**
 * Prefer a comparable pair under the same Assessment Version.
 * Falls back to newest two when versions are absent (legacy).
 */
function pickComparableScanPair(scans = []) {
  if (!Array.isArray(scans) || scans.length < 2) {
    return { current: scans?.[0] || null, baseline: scans?.[1] || null };
  }
  const current = scans[0];
  const currentVid = current?.assessmentVersionId
    ? String(current.assessmentVersionId)
    : "";
  const baseline =
    scans.find((s, idx) => {
      if (idx === 0) return false;
      if (!s?.scanId || s.scanId === current.scanId) return false;
      const vid = s.assessmentVersionId ? String(s.assessmentVersionId) : "";
      if (!currentVid && !vid) return true;
      return Boolean(currentVid) && vid === currentVid;
    }) || null;
  return { current, baseline };
}

export async function getApplicationRemediationSummary(
  applicationId,
  { baselineScanId, currentScanId, applicationName } = {},
) {
  let left = baselineScanId || null;
  let right = currentScanId || null;
  if (!left || !right) {
    const recent = await listScanResultsForApplication(applicationId, { limit: 20 });
    const pair = pickComparableScanPair(recent);
    if (!right) right = pair.current?.scanId || null;
    if (!left) left = pair.baseline?.scanId || null;
  }

  let compare;
  try {
    compare = await compareSecurityScans(applicationId, left, right);
  } catch (err) {
    if (
      err.code === "ASSESSMENT_VERSION_COMPARE_MISMATCH" ||
      err.code === "ASSESSMENT_COMPARE_MISMATCH"
    ) {
      const recent = await listScanResultsForApplication(applicationId, { limit: 20 });
      const pair = pickComparableScanPair(recent);
      compare = await compareSecurityScans(
        applicationId,
        pair.baseline?.scanId || null,
        pair.current?.scanId || null,
      );
    } else {
      throw err;
    }
  }

  return mapCompareToRemediationSummary(compare, {
    applicationId,
    applicationName,
  });
}

/**
 * Tenant-wide Applications view: latest two scans per AD application.
 */
export async function getTenantRemediationApplicationTiles(tenantId) {
  if (!tenantId) return { applicationTiles: [] };

  const apps = await Application.find({ tenantId })
    .select("_id name type")
    .lean()
    .limit(100);

  const tiles = [];
  for (let i = 0; i < apps.length; i += 1) {
    const app = apps[i];
    const appId = String(app._id);
    const scans = await listScanResultsForApplication(appId, { limit: 20, skip: 0 });
    if (!scans?.length) {
      tiles.push({
        id: `application:${appId}`,
        applicationId: appId,
        themeKey: "_application",
        title: app.name || appId,
        percentLabel: "Progress",
        primaryColumnLabel: "Feature",
        countColumnLabel: "Remaining",
        tip: "No security assessments yet",
        progressPercent: 0,
        rows: [],
      });
      continue;
    }
    const pair = pickComparableScanPair(scans);
    if (!pair.current || !pair.baseline) {
      tiles.push({
        id: `application:${appId}`,
        applicationId: appId,
        themeKey: "_application",
        title: app.name || appId,
        percentLabel: "Progress",
        primaryColumnLabel: "Feature",
        countColumnLabel: "Remaining",
        tip: "Need at least two executions of the same Assessment Version to measure remediation progress",
        progressPercent: 0,
        rows: [],
      });
      continue;
    }
    const summary = await getApplicationRemediationSummary(appId, {
      baselineScanId: pair.baseline.scanId,
      currentScanId: pair.current.scanId,
      applicationName: app.name,
    });
    const tile = summary.applicationTiles[0];
    if (tile) tiles.push(tile);
  }

  return { applicationTiles: tiles };
}
