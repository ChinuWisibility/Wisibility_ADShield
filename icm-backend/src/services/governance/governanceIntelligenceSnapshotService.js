/**
 * Canonical server-side snapshot for Governance Intelligence export (PDF / Excel / pack).
 */
import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import Account from "../../models/access/Account.js";
import Tenant from "../../models/platform/Tenant.js";
import {
  buildOrphanIsoSummaryForApplication,
  loadAllOpenOrphansForIsoReportPayload,
  buildOrphanListFilters,
} from "../../controllers/correlation/correlationController.js";
import { buildCertificationIsoReportData } from "../../controllers/access-certification/certificationISOReportController.js";
import { resolveCertificationAccessTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { ISO_REPORT_DECISION_LIMIT_MAX } from "../../config/certificationISOReport.config.js";
import {
  computeUserStats,
  computeAccountStatusDonutCountsFromQueueDigest,
  computeDepartmentRiskBarFromQueueDigest,
  buildKeyFindings,
  buildComplianceTrendSeries,
} from "../../utils/governanceReportLifecycleMetrics.js";
import {
  ISO_GOVERNANCE_CONTROLS,
  deriveControlStatus,
  computeGovernanceHealthScore,
  governanceHealthToRiskExposure10,
} from "../../config/isoGovernanceControls.config.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import { resolveEffectiveRiskBand } from "../report/reportingRuleSetResolver.js";
import { GOVERNANCE_RISK_BAND_METRIC_KEYS } from "../../models/report/GovernanceRiskBandSetting.js";
import SodPolicy from "../../models/sod/SodPolicy.js";
import SodViolation from "../../models/sod/SodViolation.js";
import { sodTenantFilter } from "../../utils/sod/sodTenant.js";

/** Resolve tenant ObjectId for orphan/account scoping (platform admin may pass body.tenantId). */
export function resolveSnapshotTenantId(req, bodyTenantId) {
  if (bodyTenantId && mongoose.Types.ObjectId.isValid(String(bodyTenantId))) {
    if (req.user?.role === "superAdmin") {
      return new mongoose.Types.ObjectId(String(bodyTenantId));
    }
  }
  const tid = req.user?.tenantId;
  if (tid && typeof tid === "object" && tid._id) {
    return new mongoose.Types.ObjectId(String(tid._id));
  }
  if (tid && mongoose.Types.ObjectId.isValid(String(tid))) {
    return new mongoose.Types.ObjectId(String(tid));
  }
  return null;
}

function privilegedAccountQuery(applicationId, tenantOid, userRole) {
  const query = {
    $or: [{ isPrivileged: true }, { accountType: { $in: ["privileged", "admin"] } }],
    application: new mongoose.Types.ObjectId(String(applicationId)),
  };
  if (tenantOid && userRole !== "superAdmin") {
    query.tenantId = tenantOid;
  }
  return query;
}

async function loadPrivilegedAppendixRows(applicationId, tenantOid, userRole) {
  const query = privilegedAccountQuery(applicationId, tenantOid, userRole);
  const items = await Account.find(query)
    .select("nativeIdentity displayName _id")
    .sort({ nativeIdentity: 1 })
    .limit(5000)
    .lean();
  return items.map((acc) => ({
    id: acc.nativeIdentity || String(acc._id),
    displayName: acc.displayName || "—",
  }));
}

async function loadTopSeverityOrphans(tid, applicationId, limit = 40) {
  const listQuery = buildOrphanListFilters(tid, {
    applicationId,
    riskLevel: undefined,
    q: undefined,
  });
  const agg = await OrphanAccount.aggregate([
    { $match: listQuery },
    {
      $addFields: {
        _riskRank: {
          $switch: {
            branches: [
              { case: { $eq: ["$riskLevel", "CRITICAL"] }, then: 4 },
              { case: { $eq: ["$riskLevel", "HIGH"] }, then: 3 },
              { case: { $eq: ["$riskLevel", "MEDIUM"] }, then: 2 },
              { case: { $eq: ["$riskLevel", "LOW"] }, then: 1 },
            ],
            default: 0,
          },
        },
      },
    },
    { $sort: { _riskRank: -1, detectedAt: -1 } },
    { $limit: limit },
    { $project: { _riskRank: 0 } },
  ]);
  const ids = agg.map((d) => d._id).filter(Boolean);
  if (!ids.length) return [];
  const docs = await OrphanAccount.find({ _id: { $in: ids } })
    .select("accountName accountId correlationKey riskLevel detectedAt updatedAt status")
    .lean();
  const m = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => m.get(String(id))).filter(Boolean);
}

function serializeUsersForExport(users) {
  return (users || []).map((u) => {
    const raw = u?.rawData || u?._originalData || {};
    return {
      _id: u?._id != null ? String(u._id) : "",
      email: u?.email ?? raw.email ?? "",
      username: u?.username ?? raw.username ?? "",
      nativeIdentity: u?.nativeIdentity ?? raw.sAMAccountName ?? "",
      department: u?.department ?? raw.department ?? "",
      status: u?.status ?? raw.status ?? "",
      lastLogin: u?.lastLogin ?? raw.lastLogin ?? "",
    };
  });
}

function entitlementNamesForExport(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      return String(
        item.name || item.displayName || item.entitlementName || item.id || item._id || "",
      ).trim();
    })
    .filter(Boolean);
}

function conflictAccessLabel(row) {
  const left = entitlementNamesForExport(row?.leftEntitlements);
  const right = entitlementNamesForExport(row?.rightEntitlements);
  if (!left.length && !right.length) return "—";
  return `${left.length ? left.join(", ") : "—"} × ${right.length ? right.join(", ") : "—"}`;
}

/** Same scope as Iso2007Report SOD tab / certification helpers. */
async function loadSodForApplication(tenantOid, applicationId) {
  const tenantFilter = sodTenantFilter(String(tenantOid));
  const filter = { ...tenantFilter };
  if (mongoose.Types.ObjectId.isValid(String(applicationId))) {
    filter.applications = new mongoose.Types.ObjectId(String(applicationId));
  } else {
    filter.applicationNames = { $in: [String(applicationId)] };
  }
  const policies = await SodPolicy.find(filter)
    .select("_id name policyId status severity description type totalViolations")
    .lean();
  const ids = policies.map((p) => p._id).filter(Boolean);
  const violations = ids.length
    ? await SodViolation.find({ ...tenantFilter, policy: { $in: ids } })
        .select(
          "policy policyName identityName identityEmail department leftEntitlements rightEntitlements severity status detectedAt",
        )
        .sort({ detectedAt: -1 })
        .limit(2000)
        .lean()
    : [];
  const nameById = new Map(policies.map((p) => [String(p._id), p.name]));
  const enriched = violations.map((v) => ({
    _id: v._id != null ? String(v._id) : "",
    policyId: v.policy != null ? String(v.policy) : "",
    policyName: v.policyName || nameById.get(String(v.policy)) || "Policy",
    identityName: v.identityName || "",
    identityEmail: v.identityEmail || "",
    department: v.department || "",
    conflictAccess: conflictAccessLabel(v),
    severity: v.severity || "",
    status: v.status || "",
    detectedAt: v.detectedAt ? new Date(v.detectedAt).toISOString() : "",
  }));
  const openCount = enriched.filter(
    (v) => String(v.status || "").toLowerCase() === "open",
  ).length;
  return {
    policies: policies.map((p) => ({
      _id: String(p._id),
      name: p.name || "",
      policyId: p.policyId || "",
      status: p.status || "",
      severity: p.severity || "",
      type: p.type || "",
      totalViolations: p.totalViolations ?? 0,
    })),
    violations: enriched,
    summary: {
      policyCount: policies.length,
      violationCount: enriched.length,
      openViolationCount: openCount,
    },
  };
}

/**
 * @param {import('express').Request} req
 * @param {{ tenantId?: string, applicationId: string, asOf?: string, includeAppendix?: boolean }} opts
 */
export async function buildGovernanceIntelligenceSnapshot(req, opts) {
  const { applicationId, asOf, includeAppendix = true } = opts;
  if (!applicationId || !mongoose.Types.ObjectId.isValid(String(applicationId))) {
    throw new Error("Valid applicationId is required");
  }

  let tid = resolveSnapshotTenantId(req, opts.tenantId);
  if (!tid) {
    if (req.user?.role === "superAdmin") {
      throw new Error(
        "tenantId is required in the export request body for platform administrators",
      );
    }
    const inferred = await resolveCertificationAccessTenantId(req);
    if (inferred && mongoose.Types.ObjectId.isValid(String(inferred))) {
      tid = new mongoose.Types.ObjectId(String(inferred));
    }
  }
  if (!tid) {
    throw new Error("Tenant context is required");
  }

  const appOid = new mongoose.Types.ObjectId(String(applicationId));
  const application = await Application.findById(appOid).select("name tenantId applicationName").lean();
  if (!application?.name) {
    throw new Error("Application not found");
  }
  if (String(application.tenantId) !== String(tid)) {
    throw new Error("Application not in tenant scope");
  }

  const privQuery = privilegedAccountQuery(applicationId, tid, req.user?.role);

  const [tenantLabel, orphanSummaryPack, privilegedAppendixRows, privilegedTotal, certData, sodData] =
    await Promise.all([
      Tenant.findById(tid).select("name").lean(),
      buildOrphanIsoSummaryForApplication(tid, applicationId, application),
      loadPrivilegedAppendixRows(applicationId, tid, req.user?.role),
      Account.countDocuments(privQuery),
      buildCertificationIsoReportData({
        userTenantId: await resolveCertificationAccessTenantId(req),
        applicationId: String(applicationId),
        applicationName: application.name,
        startDate: undefined,
        endDate: undefined,
        recordLimit: ISO_REPORT_DECISION_LIMIT_MAX,
      }),
      loadSodForApplication(tid, applicationId),
    ]);

  const users = orphanSummaryPack.applicationUsers || [];
  const stats = computeUserStats(users);
  const digest = {
    total: orphanSummaryPack.total,
    matchedQueueRowCount: orphanSummaryPack.matchedQueueRowCount,
    queueMatchUserIds: orphanSummaryPack.queueMatchUserIds,
  };

  const privilegedCount = privilegedTotal;
  const accountLifecycleCounts = computeAccountStatusDonutCountsFromQueueDigest(
    users,
    privilegedAppendixRows,
    digest,
  );
  const governanceHealth = computeGovernanceHealthScore(stats, privilegedCount, accountLifecycleCounts.orphan);
  const riskExposure10 = governanceHealthToRiskExposure10(governanceHealth);

  const lifecycleDonutRows = [
    { name: "Standard active", value: accountLifecycleCounts.standardActive },
    { name: "Privileged", value: accountLifecycleCounts.privileged },
    { name: "Inactive", value: accountLifecycleCounts.inactive },
    { name: "Dormant", value: accountLifecycleCounts.dormant },
    { name: "Orphan / uncorrelated", value: accountLifecycleCounts.orphan },
  ].filter((r) => r.value > 0);

  const departmentRiskBar = computeDepartmentRiskBarFromQueueDigest(users, privilegedAppendixRows, digest);
  const complianceTrend = buildComplianceTrendSeries(governanceHealth ?? 72, stats);
  const keyFindings = buildKeyFindings(stats, privilegedCount, accountLifecycleCounts.orphan, digest.total);

  const sodOpen = sodData.summary.openViolationCount;
  const sodPolicies = sodData.summary.policyCount;
  if (sodOpen > 0) {
    keyFindings.unshift({
      type: "warning",
      text: `${sodOpen} open SoD violation${sodOpen === 1 ? "" : "s"} for policies scoped to this application — review the SOD tab and SoD violations workspace.`,
    });
  } else if (sodPolicies > 0) {
    keyFindings.push({
      type: "info",
      text: `SoD: ${sodPolicies} polic${sodPolicies === 1 ? "y" : "ies"} in scope for this application — no open violations.`,
    });
  }

  const controlRows = ISO_GOVERNANCE_CONTROLS.map((c) => ({
    id: c.id,
    title: c.title,
    domain: c.domain,
    desc: c.desc,
    status: deriveControlStatus(c.id, stats, privilegedCount, accountLifecycleCounts.orphan),
  }));

  const topOrphans = await loadTopSeverityOrphans(tid, applicationId, 35);

  let fullOrphans = [];
  if (includeAppendix) {
    const pack = await loadAllOpenOrphansForIsoReportPayload(tid, applicationId);
    fullOrphans = pack.data || [];
  }

  const riskBands = {};
  for (const key of GOVERNANCE_RISK_BAND_METRIC_KEYS) {
    const band = await resolveEffectiveRiskBand(tid, appOid, key);
    riskBands[key] = {
      mediumStartsAtPct: band.mediumStartsAtPct,
      highStartsAtPct: band.highStartsAtPct,
      criticalStartsAtPct: band.criticalStartsAtPct,
    };
  }

  return {
    meta: {
      tenantId: String(tid),
      tenantName: tenantLabel?.name || "",
      applicationId: String(applicationId),
      applicationName: application.name || application.applicationName || "",
      asOf: asOf || new Date().toISOString(),
      generatedAt: new Date().toISOString(),
    },
    overview: {
      kpis: {
        totalUsers: stats.total,
        activeUsers: stats.active,
        inactiveUsers: stats.inactive,
        privilegedAccounts: privilegedCount,
        orphanUncorrelatedLifecycle: accountLifecycleCounts.orphan,
        openUncorrelatedQueue: digest.total,
      },
      governanceHealth,
      riskExposure10,
      accountLifecycleCounts,
      lifecycleDonutRows,
      departmentRiskBar,
      complianceTrend,
      keyFindings,
    },
    controls: { rows: controlRows },
    certifications: certData,
    sod: sodData,
    accounts: {
      usersSerialized: serializeUsersForExport(users),
      privilegedAppendixRows,
      topOrphans,
      fullOrphans,
      summary: {
        userCount: users.length,
        openQueueRows: digest.total,
        privilegedAccountRecords: privilegedCount,
      },
    },
    // Alert / notification thresholds are hidden in the UI — export risk bands only.
    thresholds: {},
    riskBands,
  };
}
