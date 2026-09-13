import {
  getScanResult,
  listScanResultsForApplication,
} from "../posture/postureScanResultsStore.js";
import { evaluateFinding } from "./securityPolicyEngine.js";
import { loadSecurityPolicies } from "./securityPolicyService.js";
import Application from "../../models/application/Application.js";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4, "not defined": 5 };

function normalizeSeverity(riskLevel) {
  const s = String(riskLevel || "").trim().toLowerCase();
  if (s === "not defined") return "not defined";
  if (SEVERITY_ORDER[s] !== undefined) return s;
  return "not defined";
}

async function resolvePoliciesForScan(scanDoc) {
  if (!scanDoc) return [];
  const applicationId = scanDoc.applicationId;
  let tenantId = scanDoc.tenantId || null;

  if (applicationId && !tenantId) {
    const app = await Application.findById(applicationId).select("tenantId").lean();
    tenantId = app?.tenantId ? String(app.tenantId) : null;
  }

  return loadSecurityPolicies({
    tenantId,
    applicationId: applicationId ? String(applicationId) : null,
  });
}

/**
 * Flatten and policy-evaluate findings from a scan payload.
 * @param {object} scanDoc
 * @param {object[]} [policies]
 */
export async function flattenScanFindings(scanDoc, policies = null) {
  if (!scanDoc) return [];

  const policyList = policies ?? (await resolvePoliciesForScan(scanDoc));
  const raw = [];

  if (Array.isArray(scanDoc.findings) && scanDoc.findings.length) {
    raw.push(...scanDoc.findings);
  } else {
    for (const mod of scanDoc.results || []) {
      raw.push(...(mod.findings || []));
    }
  }

  return raw.map((f, idx) =>
    normalizeFinding(evaluateFinding(f, policyList), scanDoc, idx),
  );
}

function normalizeFinding(f, scanDoc, idx) {
  const severity = normalizeSeverity(f.severity || f.riskLevel);
  const evidence = f.evidence || f.metadata || {};
  return {
    id: `${scanDoc.scanId || "scan"}-${idx}`,
    scanId: f.scanId || scanDoc.scanId,
    feature: f.feature || "",
    findingType: f.findingType || "",
    findingSignals: f.findingSignals || [],
    severity,
    riskLevel: f.riskLevel || severity,
    matchedPolicyId: f.matchedPolicyId || null,
    matchedPolicyKey: f.matchedPolicyKey || null,
    matchedPolicyName: f.matchedPolicyName || "",
    objectType: f.objectType || "",
    objectName: f.objectName || "—",
    dn: f.dn || "",
    status: f.status || "",
    recommendation: f.recommendation || "",
    attributes: f.attributes || {},
    evidence,
    metadata: evidence,
    relationships: f.relationships || [],
    applicationId: scanDoc.applicationId,
    scannedAt: scanDoc.completedAt || scanDoc.startedAt,
    policyEvaluatedAt: f.policyEvaluatedAt || null,
  };
}

function matchesSearch(finding, search) {
  const q = String(search || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    finding.objectName,
    finding.dn,
    finding.feature,
    finding.findingType,
    finding.matchedPolicyName,
    finding.status,
    finding.recommendation,
    JSON.stringify(finding.evidence),
    JSON.stringify(finding.attributes),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * @param {string} applicationId
 * @param {object} query
 */
export async function getSecurityOverview(applicationId, { scanId } = {}) {
  const appId = String(applicationId || "").trim();
  let scan = scanId ? await getScanResult(scanId) : null;
  if (scan && appId && String(scan.applicationId) !== appId) {
    scan = null;
  }
  if (!scan) {
    const recent = await listScanResultsForApplication(appId, 1);
    scan = recent[0] || null;
  }

  const recentScans = await listScanResultsForApplication(appId, 2);
  const previousScan =
    recentScans.length > 1 && recentScans[0]?.scanId === scan?.scanId
      ? recentScans[1]
      : recentScans.length > 1
        ? recentScans[1]
        : null;

  const policies = await resolvePoliciesForScan(scan);
  const findings = await flattenScanFindings(scan, policies);
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, "not defined": 0 };
  const byFeature = {};

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byFeature[f.feature] = (byFeature[f.feature] || 0) + 1;
  }

  const started = scan?.startedAt ? Date.parse(scan.startedAt) : null;
  const completed = scan?.completedAt ? Date.parse(scan.completedAt) : null;
  const durationMs =
    started && completed && completed >= started ? completed - started : null;

  const disabledUsers = byFeature.disabled_users || 0;
  let previousDisabledUsers = 0;
  let previousByFeature = {};
  let previousTotals = null;
  let comparison = null;
  if (previousScan) {
    const prevPolicies = await resolvePoliciesForScan(previousScan);
    const prevFindings = await flattenScanFindings(previousScan, prevPolicies);
    previousDisabledUsers = prevFindings.filter((f) => f.feature === "disabled_users").length;
    const prevSev = { critical: 0, high: 0, medium: 0, low: 0, "not defined": 0 };
    for (const f of prevFindings) {
      prevSev[f.severity] = (prevSev[f.severity] || 0) + 1;
      previousByFeature[f.feature] = (previousByFeature[f.feature] || 0) + 1;
    }
    previousTotals = {
      findings: prevFindings.length,
      critical: prevSev.critical,
      high: prevSev.high,
      medium: prevSev.medium,
      low: prevSev.low,
      notDefined: prevSev["not defined"],
    };
    comparison = summarizeComparison(prevFindings, findings, previousScan, scan);
  }
  const disabledUsersTrend = disabledUsers - previousDisabledUsers;

  const featureDeltas = {};
  const allFeatureKeys = new Set([
    ...Object.keys(byFeature),
    ...Object.keys(previousByFeature),
  ]);
  for (const key of allFeatureKeys) {
    const cur = byFeature[key] || 0;
    const prev = previousByFeature[key] || 0;
    featureDeltas[key] = cur - prev;
  }
  const improved = Object.entries(featureDeltas)
    .filter(([, d]) => d < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 8)
    .map(([feature, delta]) => ({ feature, delta }));
  const degraded = Object.entries(featureDeltas)
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([feature, delta]) => ({ feature, delta }));

  return {
    scan: scan
      ? {
          scanId: scan.scanId,
          status: scan.status || "completed",
          startedAt: scan.startedAt,
          completedAt: scan.completedAt,
          durationMs,
          modules: scan.modules || [],
          summary: scan.summary,
          policySnapshot: scan.policySnapshot || null,
          diagnostics: scan.diagnostics || [],
          scanConfig: scan.scanConfig || null,
        }
      : null,
    previousScanId: previousScan?.scanId || null,
    totals: {
      findings: findings.length,
      critical: bySeverity.critical,
      high: bySeverity.high,
      medium: bySeverity.medium,
      low: bySeverity.low,
      notDefined: bySeverity["not defined"],
    },
    previousTotals,
    trends: {
      severity: previousTotals
        ? {
            findings: (totalsDelta(findings.length, previousTotals.findings)),
            critical: totalsDelta(bySeverity.critical, previousTotals.critical),
            high: totalsDelta(bySeverity.high, previousTotals.high),
            medium: totalsDelta(bySeverity.medium, previousTotals.medium),
            low: totalsDelta(bySeverity.low, previousTotals.low),
          }
        : null,
      featureDeltas,
      improved,
      degraded,
    },
    comparison,
    byFeature,
    userSummary: {
      disabledUsers,
      disabledUsersTrend,
      inactiveUsers: byFeature.inactive_users || 0,
      lockedAccounts: byFeature.locked_accounts || 0,
    },
    privilegedSummary: {
      escalationPaths: byFeature.privilege_escalation_paths || 0,
      dormantPrivileged: byFeature.dormant_privileged_users || 0,
      excessivePrivileges: byFeature.excessive_privileges || 0,
      nestedPrivileged: byFeature.nested_privileged_access || 0,
      toxicCombinations: byFeature.toxic_privilege_combinations || 0,
    },
    groupSummary: {
      emptyGroups: byFeature.empty_groups || 0,
      orphanGroups: byFeature.orphan_groups || 0,
      circularMemberships: byFeature.circular_memberships || 0,
      nestedGroups: byFeature.nested_groups || 0,
      duplicateGroups: byFeature.duplicate_groups || 0,
    },
    aclSummary: {
      orphanSids: byFeature.orphan_sids || 0,
      shadowAdmins: byFeature.shadow_admins || 0,
      sidHistoryAnalysis: byFeature.sid_history_analysis || 0,
      foreignSecurityPrincipals: byFeature.foreign_security_principals || 0,
      unknownSidBindings: byFeature.unknown_sid_bindings || 0,
      brokenAcls: byFeature.broken_acls || 0,
    },
    computerSummary: {
      disabledComputers: byFeature.disabled_computers || 0,
      inactiveComputers: byFeature.inactive_computers || 0,
      missingOsInformation: byFeature.missing_os_information || 0,
      unsupportedOsVersions: byFeature.unsupported_os_versions || 0,
      serversInWrongOu: byFeature.servers_in_wrong_ou || 0,
      duplicateSpns: byFeature.duplicate_spns || 0,
      computersWithoutOwners: byFeature.computers_without_owners || 0,
    },
    kerberosSummary: {
      kerberoastableAccounts: byFeature.kerberoastable_accounts || 0,
      asrepRoastableUsers: byFeature.asrep_roastable_users || 0,
      preauthDisabled: byFeature.preauth_disabled || 0,
      spnMisconfigurations: byFeature.spn_misconfigurations || 0,
    },
    delegationSummary: {
      unconstrainedDelegation: byFeature.unconstrained_delegation || 0,
      constrainedDelegation: byFeature.constrained_delegation || 0,
      rbcd: byFeature.rbcd || 0,
      // delegationExposure: byFeature.delegation_exposure || 0, // disabled — Delegation Exposure Summary
    },
  };
}

/**
 * Paginated filtered findings from a scan (policy-evaluated at read time).
 */
export async function getPaginatedFindings(applicationId, query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const { scanId, severity, feature, objectType, search } = query;

  let scan = scanId ? await getScanResult(scanId) : null;
  if (!scan) {
    const recent = await listScanResultsForApplication(applicationId, 1);
    scan = recent[0] || null;
  }

  let findings = await flattenScanFindings(scan);

  if (severity) {
    const wanted = String(severity).toLowerCase().split(",").map((s) => s.trim());
    findings = findings.filter((f) => wanted.includes(f.severity));
  }
  if (feature) {
    const wanted = String(feature).split(",").map((s) => s.trim());
    findings = findings.filter((f) => wanted.includes(f.feature));
  }
  if (objectType) {
    const wanted = String(objectType).toLowerCase().split(",");
    findings = findings.filter((f) =>
      wanted.includes(String(f.objectType).toLowerCase()),
    );
  }
  if (search) {
    findings = findings.filter((f) => matchesSearch(f, search));
  }

  findings.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 9;
    const sb = SEVERITY_ORDER[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.objectName).localeCompare(String(b.objectName));
  });

  const total = findings.length;
  const start = (page - 1) * limit;
  const items = findings.slice(start, start + limit);

  return {
    scanId: scan?.scanId || null,
    scannedAt: scan?.completedAt || scan?.startedAt || null,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
    items,
  };
}

function totalsDelta(current, previous) {
  return (current || 0) - (previous || 0);
}

export function findingFingerprint(f) {
  if (!f) return "";
  const feature = String(f.feature || "").trim();
  const dn = String(f.dn || "").trim().toLowerCase();
  const type = String(f.findingType || f.status || "").trim();
  return `${feature}::${dn}::${type}`;
}

function summarizeComparison(olderFindings, newerFindings, olderScan, newerScan) {
  const olderMap = new Map();
  for (const f of olderFindings || []) {
    olderMap.set(findingFingerprint(f), f);
  }
  const newerMap = new Map();
  for (const f of newerFindings || []) {
    newerMap.set(findingFingerprint(f), f);
  }
  let resolved = 0;
  let unchanged = 0;
  let added = 0;
  for (const key of olderMap.keys()) {
    if (newerMap.has(key)) unchanged += 1;
    else resolved += 1;
  }
  for (const key of newerMap.keys()) {
    if (!olderMap.has(key)) added += 1;
  }
  return {
    leftScanId: olderScan?.scanId || null,
    rightScanId: newerScan?.scanId || null,
    leftCompletedAt: olderScan?.completedAt || olderScan?.startedAt || null,
    rightCompletedAt: newerScan?.completedAt || newerScan?.startedAt || null,
    resolved,
    new: added,
    unchanged,
  };
}

/**
 * Compare two assessments: Resolved / New / Unchanged by finding fingerprint.
 * Additive API — does not change scan storage or detectors.
 * When both executions belong to Assessments, they must share the same assessmentId.
 * When both have Assessment Versions, they must share the same assessmentVersionId.
 * @param {string} applicationId
 * @param {string} leftScanId
 * @param {string} rightScanId
 * @param {{ assessmentId?: string, assessmentVersionId?: string }} [options]
 */
export async function compareSecurityScans(applicationId, leftScanId, rightScanId, options = {}) {
  const appId = String(applicationId || "").trim();
  const scopedAssessmentId = options?.assessmentId
    ? String(options.assessmentId).trim()
    : "";
  const scopedVersionId = options?.assessmentVersionId
    ? String(options.assessmentVersionId).trim()
    : "";
  let left = leftScanId ? await getScanResult(leftScanId) : null;
  let right = rightScanId ? await getScanResult(rightScanId) : null;

  if (left && appId && String(left.applicationId) !== appId) left = null;
  if (right && appId && String(right.applicationId) !== appId) right = null;

  if (!left || !right) {
    const listOpts =
      scopedVersionId || scopedAssessmentId
        ? {
            limit: 2,
            assessmentId: scopedAssessmentId || undefined,
            assessmentVersionId: scopedVersionId || undefined,
          }
        : 2;
    const recent = await listScanResultsForApplication(appId, listOpts);
    if (!right) right = recent[0] || null;
    if (!left) {
      left =
        recent.find((s) => s.scanId && s.scanId !== right?.scanId) || recent[1] || null;
    }
  }

  if (!left || !right) {
    return {
      leftScanId: left?.scanId || null,
      rightScanId: right?.scanId || null,
      assessmentId: scopedAssessmentId || left?.assessmentId || right?.assessmentId || null,
      assessmentVersionId:
        scopedVersionId || left?.assessmentVersionId || right?.assessmentVersionId || null,
      resolved: 0,
      new: 0,
      unchanged: 0,
      remaining: 0,
      reopened: 0,
      baselineFindings: 0,
      currentFindings: 0,
      progressPercent: 0,
      byFeature: {},
      resolvedItems: [],
      newItems: [],
      unchangedItems: [],
      remainingItems: [],
      message: "Run a second security scan to compare progress.",
    };
  }

  const leftAid = left.assessmentId ? String(left.assessmentId) : "";
  const rightAid = right.assessmentId ? String(right.assessmentId) : "";
  if (leftAid && rightAid && leftAid !== rightAid) {
    const err = new Error(
      "Compare is only allowed between executions of the same Assessment.",
    );
    err.code = "ASSESSMENT_COMPARE_MISMATCH";
    throw err;
  }
  if (scopedAssessmentId) {
    if ((leftAid && leftAid !== scopedAssessmentId) || (rightAid && rightAid !== scopedAssessmentId)) {
      const err = new Error(
        "One or both executions do not belong to the selected Assessment.",
      );
      err.code = "ASSESSMENT_COMPARE_MISMATCH";
      throw err;
    }
  }

  const leftVid = left.assessmentVersionId ? String(left.assessmentVersionId) : "";
  const rightVid = right.assessmentVersionId ? String(right.assessmentVersionId) : "";
  // Same Version required when either side is version-bound (legacy both-empty still allowed).
  if (leftVid !== rightVid) {
    const err = new Error(
      "Compare is only allowed between executions of the same Assessment Version. Cross-version comparisons are rejected because configuration may differ.",
    );
    err.code = "ASSESSMENT_VERSION_COMPARE_MISMATCH";
    throw err;
  }
  if (scopedVersionId) {
    if (!leftVid || leftVid !== scopedVersionId || !rightVid || rightVid !== scopedVersionId) {
      const err = new Error(
        "One or both executions do not belong to the selected Assessment Version.",
      );
      err.code = "ASSESSMENT_VERSION_COMPARE_MISMATCH";
      throw err;
    }
  }

  // Ensure left is older when both timestamps exist
  const leftTime = Date.parse(left.completedAt || left.startedAt || 0) || 0;
  const rightTime = Date.parse(right.completedAt || right.startedAt || 0) || 0;
  if (leftTime > rightTime) {
    const tmp = left;
    left = right;
    right = tmp;
  }

  const leftPolicies = await resolvePoliciesForScan(left);
  const rightPolicies = await resolvePoliciesForScan(right);
  const olderFindings = await flattenScanFindings(left, leftPolicies);
  const newerFindings = await flattenScanFindings(right, rightPolicies);

  const olderMap = new Map();
  for (const f of olderFindings) olderMap.set(findingFingerprint(f), f);
  const newerMap = new Map();
  for (const f of newerFindings) newerMap.set(findingFingerprint(f), f);

  const resolvedItems = [];
  const newItems = [];
  const unchangedItems = [];

  for (const [key, f] of olderMap) {
    if (newerMap.has(key)) unchangedItems.push({ ...f, compareClass: "unchanged" });
    else resolvedItems.push({ ...f, compareClass: "resolved" });
  }
  for (const [key, f] of newerMap) {
    if (!olderMap.has(key)) newItems.push({ ...f, compareClass: "new" });
  }

  const SAMPLE = 50;
  const resolved = resolvedItems.length;
  const remaining = unchangedItems.length;
  const added = newItems.length;
  const baselineFindings = resolved + remaining;
  const currentFindings = remaining + added;
  const progressPercent =
    baselineFindings > 0 ? Math.round((resolved / baselineFindings) * 100) : 0;

  /** Pairwise compare cannot detect reopened without an intermediate execution. */
  const reopened = 0;

  const byFeature = buildCompareByFeature({
    resolvedItems,
    remainingItems: unchangedItems,
    newItems,
  });

  return {
    leftScanId: left.scanId,
    rightScanId: right.scanId,
    assessmentId: leftAid || rightAid || scopedAssessmentId || null,
    assessmentVersionId:
      (left.assessmentVersionId ? String(left.assessmentVersionId) : "") ||
      (right.assessmentVersionId ? String(right.assessmentVersionId) : "") ||
      scopedVersionId ||
      null,
    leftCompletedAt: left.completedAt || left.startedAt || null,
    rightCompletedAt: right.completedAt || right.startedAt || null,
    resolved,
    new: added,
    unchanged: remaining,
    remaining,
    reopened,
    baselineFindings,
    currentFindings,
    progressPercent,
    byFeature,
    resolvedItems: resolvedItems.slice(0, SAMPLE),
    newItems: newItems.slice(0, SAMPLE),
    unchangedItems: unchangedItems.slice(0, SAMPLE),
    remainingItems: unchangedItems.slice(0, SAMPLE),
  };
}

function emptyFeatureBucket() {
  return {
    baseline: 0,
    current: 0,
    resolved: 0,
    remaining: 0,
    new: 0,
    reopened: 0,
    progressPercent: 0,
  };
}

function buildCompareByFeature({ resolvedItems, remainingItems, newItems }) {
  const map = {};
  const bump = (feature, field, n = 1) => {
    const key = String(feature || "unknown");
    if (!map[key]) map[key] = emptyFeatureBucket();
    map[key][field] += n;
  };
  for (const f of resolvedItems || []) bump(f.feature, "resolved");
  for (const f of remainingItems || []) bump(f.feature, "remaining");
  for (const f of newItems || []) bump(f.feature, "new");
  for (const bucket of Object.values(map)) {
    bucket.baseline = bucket.resolved + bucket.remaining;
    bucket.current = bucket.remaining + bucket.new;
    bucket.progressPercent =
      bucket.baseline > 0 ? Math.round((bucket.resolved / bucket.baseline) * 100) : 0;
  }
  return map;
}
