/**
 * Identity-scoped catalog insight APIs: SoD, certifications, data hygiene.
 * Used by Identity Detail tabs (read-only).
 */

import mongoose from 'mongoose';
import SodViolation from '../../models/sod/SodViolation.js';
import SodException from '../../models/sod/SodException.js';
import ReviewItem from '../../models/certification/ReviewItem.js';
import Campaign from '../../models/certification/Campaign.js';
import IdentityAccountLink from '../../models/identity/IdentityAccountLink.js';
import OrphanAccount from '../../models/identity/OrphanAccount.js';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../../models/identity/Identity.js';
import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { resolveLiveApplicationUser } from '../../controllers/correlation/identityAccountLinkController.js';
import { sodTenantFilter } from '../../utils/sod/sodTenant.js';
import { resolvePostureRules } from './posture/postureRuleResolver.js';
import {
  computeIdentityHygiene,
  loadAccessInventoryByApplication,
} from './posture/identityPostureDashboard.js';

function normalizeEmail(value) {
  const s = String(value || '').trim().toLowerCase();
  return s || null;
}

function toObjectId(value) {
  if (!value) return null;
  const s = String(value);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

async function resolveTenantIdForIdentity(identityId, scopedTenantId) {
  if (scopedTenantId && mongoose.Types.ObjectId.isValid(String(scopedTenantId))) {
    return scopedTenantId;
  }
  const LegacyIdentity = getLegacyIdentityModel();
  const stub = await LegacyIdentity.findById(identityId).select('tenantId').lean();
  return stub?.tenantId || null;
}

async function loadIdentityDocument(identityId, scopedTenantId) {
  if (!mongoose.Types.ObjectId.isValid(String(identityId))) {
    const err = new Error('Invalid identity ID');
    err.statusCode = 400;
    throw err;
  }

  const tenantId = await resolveTenantIdForIdentity(identityId, scopedTenantId);
  if (!tenantId) {
    const err = new Error('Identity not found');
    err.statusCode = 404;
    throw err;
  }

  const IdentityModel = await getDynamicIdentityModelForTenantId(tenantId);
  const identity = await IdentityModel.findById(identityId).lean();
  if (!identity) {
    const err = new Error('Identity not found');
    err.statusCode = 404;
    throw err;
  }

  return { identity, tenantId };
}

function buildSodMatchFilter(identityId, identity, tenantId) {
  const orClauses = [{ identity: toObjectId(identityId) }].filter(Boolean);
  const email = normalizeEmail(identity?.email);
  if (email) orClauses.push({ identityEmail: email });
  return {
    ...sodTenantFilter(tenantId),
    $or: orClauses,
  };
}

/** Keep only SoD violations for this identity (never other users on the same policy). */
function sodViolationBelongsToIdentity(violation, identityId, identity) {
  if (!violation) return false;
  const idStr = String(identityId);
  if (violation.identity != null && String(violation.identity) === idStr) return true;
  const email = normalizeEmail(identity?.email);
  const vEmail = normalizeEmail(violation.identityEmail);
  if (email && vEmail && email === vEmail) return true;
  return false;
}

function conflictLabel(violation) {
  const left = (violation.leftEntitlements || []).map((e) => e.name).filter(Boolean);
  const right = (violation.rightEntitlements || []).map((e) => e.name).filter(Boolean);
  if (left.length && right.length) return `${left.join(', ')} + ${right.join(', ')}`;
  return violation.ruleName || violation.policyName || 'SoD conflict';
}

/**
 * GET /identities/:id/sod
 */
export async function buildIdentitySodInsights(identityId, scopedTenantId) {
  const { identity, tenantId } = await loadIdentityDocument(identityId, scopedTenantId);
  const filter = buildSodMatchFilter(identityId, identity, tenantId);

  const violationsRaw = await SodViolation.find(filter)
    .sort({ detectedAt: -1 })
    .limit(200)
    .lean();
  const violations = violationsRaw.filter((v) =>
    sodViolationBelongsToIdentity(v, identityId, identity),
  );

  const open = violations.filter((v) => String(v.status || '').toLowerCase() === 'open');
  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const v of open) {
    const sev = String(v.severity || 'MEDIUM').toUpperCase();
    if (bySeverity[sev] != null) bySeverity[sev] += 1;
    else bySeverity.MEDIUM += 1;
  }

  const violationIds = violations.map((v) => v._id).filter(Boolean);
  let exceptions = [];
  if (violationIds.length) {
    exceptions = await SodException.find({
      violationId: { $in: violationIds },
      exceptionStatus: 'ACTIVE',
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  }

  const email = normalizeEmail(identity.email);
  const subjectName =
    identity.displayName
    || [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim()
    || null;
  const deepLinkBase = email
    ? `/governance/sod-violations?q=${encodeURIComponent(email)}`
    : '/governance/sod-violations';

  const exceptionByViolation = new Map(
    exceptions.map((ex) => [String(ex.violationId), ex]),
  );

  return {
    identityId: String(identity._id),
    email: identity.email || null,
    subjectName,
    subjectEmail: identity.email || null,
    summary: {
      openCount: open.length,
      totalCount: violations.length,
      criticalHigh: bySeverity.CRITICAL + bySeverity.HIGH,
      bySeverity,
      exceptionCount: exceptions.length,
      remediatedCount: violations.filter((v) => String(v.status || '').toLowerCase() === 'remediated').length,
    },
    violations: violations.map((v) => {
      const ex = exceptionByViolation.get(String(v._id));
      return {
        id: String(v._id),
        policyId: v.policy ? String(v.policy) : null,
        policyName: v.policyName || null,
        ruleName: v.ruleName || null,
        conflict: conflictLabel(v),
        severity: v.severity || 'MEDIUM',
        status: v.status || 'open',
        riskScore: v.riskScore ?? 0,
        detectedAt: v.detectedAt || v.createdAt || null,
        subjectName,
        subjectEmail: identity.email || v.identityEmail || null,
        hasActiveException: Boolean(ex),
        exceptionReason: ex?.exceptionReason || null,
        deepLink: v.policy
          ? `/governance/sod-policies/${v.policy}`
          : deepLinkBase,
      };
    }),
    exceptions: exceptions.map((ex) => ({
      id: String(ex._id),
      violationId: ex.violationId ? String(ex.violationId) : null,
      reason: ex.exceptionReason || null,
      approvedBy: ex.approvedBy || null,
      validTo: ex.validTo || null,
      status: ex.exceptionStatus || 'ACTIVE',
    })),
    deepLink: deepLinkBase,
  };
}

function buildCertificationMatchOr(identity) {
  const clauses = [];
  const idStr = String(identity._id);
  const oid = toObjectId(identity._id);
  if (oid) {
    clauses.push({ 'provisioningPayload.identityId': oid });
  }

  const email = normalizeEmail(identity.email);
  if (email) {
    clauses.push({ itemEmail: email });
    clauses.push({ userId: email });
  }

  const employeeId = String(identity.employeeId || '').trim();
  if (employeeId) {
    clauses.push({ userId: employeeId });
    clauses.push({ userPrimaryKey: employeeId });
  }

  clauses.push({ userId: idStr });

  return clauses;
}

/** Keep only review items that belong to this identity (never other campaign members). */
function reviewItemBelongsToIdentity(item, identity) {
  if (!item || !identity) return false;
  const idStr = String(identity._id);
  const email = normalizeEmail(identity.email);
  const employeeId = String(identity.employeeId || '').trim().toLowerCase();

  const payloadId = item.provisioningPayload?.identityId;
  if (payloadId != null && String(payloadId) === idStr) return true;

  const userId = String(item.userId || '').trim();
  const userIdNorm = userId.toLowerCase();
  if (userId === idStr) return true;
  if (email && userIdNorm === email) return true;
  if (employeeId && userIdNorm === employeeId) return true;

  const itemEmail = normalizeEmail(item.itemEmail);
  if (email && itemEmail && itemEmail === email) return true;

  const pk = String(item.userPrimaryKey || '').trim().toLowerCase();
  if (employeeId && pk && pk === employeeId) return true;

  return false;
}

/**
 * GET /identities/:id/certifications
 */
export async function buildIdentityCertificationInsights(identityId, scopedTenantId) {
  const { identity, tenantId } = await loadIdentityDocument(identityId, scopedTenantId);
  const orClauses = buildCertificationMatchOr(identity);
  if (!orClauses.length) {
    const accessTrend = await buildIdentityAccessTrend(identityId, tenantId, []);
    return {
      identityId: String(identity._id),
      summary: {
        total: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        revoked: 0,
      },
      items: [],
      recentCampaigns: [],
      accessTrend,
      deepLink: '/governance/certifications/access',
    };
  }

  const tenantOid = toObjectId(tenantId);
  const match = {
    $or: orClauses,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
  };

  const itemsRaw = await ReviewItem.find(match)
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  // Strict post-filter: $or match can be loose; never include other campaign members.
  const items = itemsRaw.filter((item) => reviewItemBelongsToIdentity(item, identity));

  const campaignIds = [...new Set(items.map((i) => String(i.campaignId)).filter(Boolean))];
  const campaigns = campaignIds.length
    ? await Campaign.find({ _id: { $in: campaignIds.map((id) => toObjectId(id)).filter(Boolean) } })
        .select(
          'name status dueDate endDate startDate category certificationScope progress completionPercentage totalItems completedItems pendingItems',
        )
        .lean()
    : [];
  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));

  let pending = 0;
  let completed = 0;
  let revoked = 0;
  let inProgress = 0;

  const mapped = [];

  for (const item of items) {
    const status = String(item.status || 'PENDING').toUpperCase();
    if (status === 'PENDING' || status === 'DELEGATED') pending += 1;
    else if (status === 'APPROVED' || status === 'EXCEPTION') completed += 1;
    else if (status === 'REVOKED' || status === 'REVOKE_IN_PROGRESS') revoked += 1;

    const campaign = campaignById.get(String(item.campaignId));
    const campaignStatus = String(campaign?.status || '').toUpperCase();
    if (['ACTIVE', 'IN_PROGRESS', 'RUNNING', 'OPEN', 'ENDPHASE', 'DECISIONPENDING'].includes(campaignStatus) && status === 'PENDING') {
      inProgress += 1;
    }

    const campaignId = item.campaignId ? String(item.campaignId) : null;
    const snap = item.entitlementSnapshot || {};
    const deepLink = campaignId
      ? `/governance/certifications/access?campaignId=${encodeURIComponent(campaignId)}`
      : '/governance/certifications/access';
    const applicationName =
      item.itemApplicationName ||
      snap.applicationName ||
      item.provisioningPayload?.applicationName ||
      null;
    const baseRisk = snap.riskLevel || null;
    const basePrivileged = Boolean(snap.isPrivileged);
    const reviewer = item.reviewerName || item.reviewerEmail || null;
    const dueDate = campaign?.dueDate || campaign?.endDate || null;

    const pushRow = ({
      rowKey,
      entitlementName,
      applicationLabel,
      rowStatus,
      decision,
      reviewedAt,
      isPrivileged,
      riskLevel,
      entitlementDecisionKey,
    }) => {
      mapped.push({
        id: rowKey,
        reviewItemId: String(item._id),
        campaignId,
        campaignName: campaign?.name || 'Campaign',
        campaignStatus: campaign?.status || null,
        itemId: item.itemId || null,
        itemName: item.itemName || snap.entitlementName || 'Review item',
        subjectName:
          identity.displayName
          || [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim()
          || item.itemName
          || null,
        subjectEmail: identity.email || item.itemEmail || null,
        subjectDepartment: identity.department || item.itemDepartment || null,
        applicationName: applicationLabel || applicationName,
        entitlementName:
          entitlementName
          || snap.entitlementName
          || item.provisioningPayload?.entitlementName
          || (Array.isArray(item.itemAccessDetails) && item.itemAccessDetails[0])
          || item.itemName
          || '—',
        entitlementType: isPrivileged ? 'Privileged' : 'Non-privileged',
        isPrivileged: Boolean(isPrivileged),
        riskLevel: riskLevel || baseRisk || (isPrivileged ? 'HIGH' : 'LOW'),
        status: rowStatus,
        decision: decision || null,
        reviewer,
        dueDate,
        reviewedAt: reviewedAt || null,
        createdAt: item.createdAt || null,
        entitlementDecisionKey: entitlementDecisionKey || null,
        canAct: ['PENDING', 'DELEGATED'].includes(String(rowStatus || '').toUpperCase()),
        deepLink,
      });
    };

    const entitlementDecisions = Array.isArray(item.entitlementDecisions)
      ? item.entitlementDecisions
      : [];

    if (entitlementDecisions.length > 0) {
      for (const ed of entitlementDecisions) {
        const edStatus = String(ed.status || status || 'PENDING').toUpperCase();
        pushRow({
          rowKey: `${item._id}:${ed.entitlementName || 'ent'}`,
          entitlementName: ed.entitlementName,
          applicationLabel: ed.applicationName || applicationName,
          rowStatus: edStatus,
          decision: ed.decision || (edStatus === 'PENDING' ? null : item.decision),
          reviewedAt: ed.reviewedAt || item.reviewedAt,
          isPrivileged: basePrivileged,
          riskLevel: baseRisk,
          entitlementDecisionKey: ed.entitlementName || null,
        });
      }
      continue;
    }

    const accessDetails = Array.isArray(item.itemAccessDetails)
      ? item.itemAccessDetails.filter(Boolean)
      : [];

    if (accessDetails.length > 1) {
      for (const entName of accessDetails) {
        pushRow({
          rowKey: `${item._id}:${entName}`,
          entitlementName: entName,
          applicationLabel: applicationName,
          rowStatus: status,
          decision: item.decision || null,
          reviewedAt: item.reviewedAt,
          isPrivileged: basePrivileged,
          riskLevel: baseRisk,
          entitlementDecisionKey: entName,
        });
      }
      continue;
    }

    pushRow({
      rowKey: String(item._id),
      entitlementName:
        snap.entitlementName
        || item.provisioningPayload?.entitlementName
        || accessDetails[0]
        || null,
      applicationLabel: applicationName,
      rowStatus: status,
      decision: item.decision || null,
      reviewedAt: item.reviewedAt,
      isPrivileged: basePrivileged,
      riskLevel: baseRisk,
      entitlementDecisionKey: null,
    });
  }

  const recentCampaigns = buildRecentCampaigns(
    mapped.map((row) => ({
      ...row,
      id: row.reviewItemId,
      accessCount: 1,
    })),
    campaignById,
  );
  const accessTrend = await buildIdentityAccessTrend(identityId, tenantId, mapped);

  return {
    identityId: String(identity._id),
    summary: {
      total: mapped.length,
      pending,
      inProgress,
      completed,
      revoked,
    },
    items: mapped,
    recentCampaigns,
    accessTrend,
    deepLink: '/governance/certifications/access',
  };
}

function campaignTypeLabel(campaign) {
  const category = String(campaign?.category || '').toUpperCase();
  if (category === 'ROLE_COMPOSITION' || category === 'ROLE_MEMBERSHIP') {
    return 'Role Review';
  }
  if (category === 'IDENTITY' || category === 'MANAGER') {
    return 'Identity Review';
  }
  return 'Access Certification';
}

function campaignDisplayStatus(campaign, identityStatuses) {
  const raw = String(campaign?.status || '').toUpperCase();
  if (['COMPLETED', 'CLOSED'].includes(raw)) return 'Completed';
  if (['DRAFT', 'STAGED', 'SCHEDULED'].includes(raw)) return 'Not Started';
  if (['ACTIVE', 'ENDPHASE', 'DECISIONPENDING'].includes(raw)) {
    const allDone = identityStatuses.length > 0
      && identityStatuses.every((s) => ['APPROVED', 'EXCEPTION', 'REVOKED', 'REVOKE_IN_PROGRESS'].includes(s));
    if (allDone) return 'Completed';
    const anyStarted = identityStatuses.some((s) => s !== 'PENDING' && s !== 'DELEGATED');
    return anyStarted ? 'In Progress' : 'In Progress';
  }
  return campaign?.status || 'Not Started';
}

function campaignProgressPct(_campaign, identityItems) {
  // Always this identity's review items — never campaign-wide totals.
  if (!identityItems.length) return 0;
  const done = identityItems.filter((i) =>
    ['APPROVED', 'EXCEPTION', 'REVOKED', 'REVOKE_IN_PROGRESS'].includes(i.status),
  ).length;
  return Math.round((done / identityItems.length) * 100);
}

function buildRecentCampaigns(mappedItems, campaignById) {
  const byCampaign = new Map();
  for (const item of mappedItems) {
    if (!item.campaignId) continue;
    if (!byCampaign.has(item.campaignId)) byCampaign.set(item.campaignId, []);
    byCampaign.get(item.campaignId).push(item);
  }

  const rows = [...byCampaign.entries()].map(([campaignId, identityItems]) => {
    const campaign = campaignById.get(campaignId);
    const statuses = identityItems.map((i) => i.status);
    const dueDate = campaign?.dueDate || campaign?.endDate || identityItems[0]?.dueDate || null;
    const updatedAt = identityItems.reduce((max, i) => {
      const t = new Date(i.reviewedAt || i.createdAt || 0).getTime();
      return t > max ? t : max;
    }, 0);

    return {
      id: campaignId,
      campaignId,
      name: campaign?.name || identityItems[0]?.campaignName || 'Campaign',
      type: campaignTypeLabel(campaign),
      status: campaignDisplayStatus(campaign, statuses),
      dueDate,
      progress: campaignProgressPct(campaign, identityItems),
      itemCount: identityItems.length,
      deepLink: `/governance/certifications/access?campaignId=${encodeURIComponent(campaignId)}`,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    };
  });

  return rows
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      if (bd !== ad) return bd - ad;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
    .slice(0, 5);
}

function buildEmptyAccessTrend() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      monthKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      value: 0,
    });
  }
  return months;
}

/**
 * Last-6-month access-review trend for ONE identity only.
 * Counts this identity's certification review items (the same rows shown on the
 * Certifications tab), accumulated by month. This keeps the trend total exactly
 * consistent with the Certifications summary — no entitlement/account inflation.
 */
async function buildIdentityAccessTrend(identityId, tenantId, mappedItems) {
  const months = buildEmptyAccessTrend();

  const events = (mappedItems || [])
    .map((item) => ({
      at: new Date(item.createdAt || item.reviewedAt || 0).getTime(),
    }))
    .filter((e) => Number.isFinite(e.at) && e.at > 0);

  const totalItems = (mappedItems || []).length;
  const earliest = events.length ? Math.min(...events.map((e) => e.at)) : null;

  for (let i = 0; i < months.length; i += 1) {
    const [y, m] = months[i].monthKey.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).getTime();
    const isLatest = i === months.length - 1;

    // Cumulative review items for THIS identity created by month end.
    let value = events.filter((e) => e.at <= monthEnd).length;

    // If items exist but none carry a usable date, show the true total from the
    // first month onward so the line still reconciles with the Certifications tab.
    if (value === 0 && totalItems > 0 && (earliest === null || isLatest)) {
      value = totalItems;
    }

    months[i].value = value;
  }

  return months;
}

function isInactiveAccountStatus(status) {
  const s = String(status || '').toLowerCase();
  return (
    s.includes('inactive') ||
    s.includes('disable') ||
    s.includes('term') ||
    s.includes('locked') ||
    s === 'off' ||
    s === '0'
  );
}

function accountHasAccessSignal(live, entitlementsCount) {
  if (entitlementsCount > 0) return true;
  const groups = live?.groups || live?.member_of_entitlements || live?.roles;
  if (Array.isArray(groups) && groups.length) return true;
  return false;
}

function resolveAccountManagerValue(live) {
  return (
    live?.manager ??
    live?.managerEmail ??
    live?.manager_email ??
    live?.manager_name ??
    live?.attributes?.manager ??
    live?.attributes?.managerEmail ??
    null
  );
}

/**
 * GET /identities/:id/hygiene
 * Returns the full data-hygiene widget catalog with a per-check "is this identity involved" verdict.
 */
export async function buildIdentityHygieneInsights(identityId, scopedTenantId) {
  const { identity, tenantId } = await loadIdentityDocument(identityId, scopedTenantId);
  const { rules } = await resolvePostureRules(tenantId);
  const { score: hygieneScore, attributeChecks } = computeIdentityHygiene(identity, rules);
  const attributeGaps = (attributeChecks || []).filter((c) => c.enabled && !c.ok);

  const accessInventory = await loadAccessInventoryByApplication(identityId, tenantId);
  const privilegedCount = accessInventory?.totals?.privilegedEntitlementCount || 0;
  const totalEntitlements = accessInventory?.totals?.totalEntitlements || 0;

  const links = await IdentityAccountLink.find({
    identityId: toObjectId(identityId) || identityId,
    isActive: { $ne: false },
  })
    .populate('applicationId', 'name type tenantId')
    .lean();

  const identityMgrEmail = normalizeEmail(
    identity.managerEmail || identity.manager?.email || identity.attributes?.managerEmail,
  );
  const identityHasManager = Boolean(
    identity.managerId || identityMgrEmail || String(identity.manager || '').trim(),
  );

  const missingManagerApps = [];
  const managerMismatchApps = [];
  const inactiveAccessApps = [];
  const accountsPerApp = new Map();

  for (const link of links) {
    const appDoc = link.applicationId && typeof link.applicationId === 'object' ? link.applicationId : null;
    const appName = appDoc?.name || 'Application';
    const appKey = appDoc?._id ? String(appDoc._id) : appName;
    accountsPerApp.set(appKey, {
      name: appName,
      count: (accountsPerApp.get(appKey)?.count || 0) + 1,
    });

    let live = null;
    try {
      if (appDoc?.name) {
        const DynamicUserModel = await getDynamicUserModelForTenantId(appDoc.name, appDoc.tenantId || tenantId);
        live = await resolveLiveApplicationUser(DynamicUserModel, link, appDoc);
      }
    } catch {
      /* non-fatal — treat as no live data */
    }
    if (!live) continue;

    const status = live.status || live.accountStatus || live.LifecycleState || null;
    const entCount = Array.isArray(live.entitlements) ? live.entitlements.length : 0;
    if (isInactiveAccountStatus(status) && accountHasAccessSignal(live, entCount)) {
      inactiveAccessApps.push(appName);
    }

    const mgr = resolveAccountManagerValue(live);
    const mgrStr = typeof mgr === 'object' ? mgr?.email : mgr;
    if (mgrStr === null || mgrStr === undefined || String(mgrStr).trim() === '') {
      missingManagerApps.push(appName);
    } else {
      const liveMgrEmail = normalizeEmail(mgrStr);
      if (
        identityMgrEmail &&
        liveMgrEmail &&
        identityMgrEmail.includes('@') &&
        liveMgrEmail.includes('@') &&
        identityMgrEmail !== liveMgrEmail
      ) {
        managerMismatchApps.push(appName);
      }
    }
  }

  const duplicateApps = [...accountsPerApp.values()].filter((a) => a.count > 1);

  const email = normalizeEmail(identity.email);
  const orphanFilter = {
    tenantId: toObjectId(tenantId) || tenantId,
    status: { $in: ['OPEN', 'UNDER_REVIEW'] },
  };
  let relatedOrphans = 0;
  if (email) {
    relatedOrphans = await OrphanAccount.countDocuments({
      ...orphanFilter,
      correlationKey: email,
    });
  }

  const sodFilter = buildSodMatchFilter(identityId, identity, tenantId);
  const openSodCount = await SodViolation.countDocuments({ ...sodFilter, status: 'open' });

  const certOrClauses = buildCertificationMatchOr(identity);
  const tenantOid = toObjectId(tenantId);
  const certCount = certOrClauses.length
    ? await ReviewItem.countDocuments({
        $or: certOrClauses,
        ...(tenantOid ? { tenantId: tenantOid } : {}),
      })
    : 0;

  const list = (arr) => [...new Set(arr)].join(', ');

  /** Full data-hygiene widget catalog, each with an involvement verdict for this identity. */
  const catalog = [
    {
      id: 'identityAttributes',
      kind: 'issue',
      title: 'Identity attribute completeness',
      involved: attributeGaps.length > 0,
      count: attributeGaps.length,
      severity: 'MEDIUM',
      detail: attributeGaps.length
        ? `Missing: ${attributeGaps.map((c) => c.label || c.id).join(', ')}`
        : 'All required identity attributes are populated.',
      deepLink: '/datahygine',
    },
    {
      id: 'missingManagers',
      kind: 'issue',
      title: 'Missing managers (by identity source)',
      involved: !identityHasManager,
      count: identityHasManager ? 0 : 1,
      severity: 'MEDIUM',
      detail: identityHasManager
        ? 'Identity has a manager assigned.'
        : 'No manager is assigned to this identity.',
      deepLink: '/datahygine/missingManagers',
    },
    {
      id: 'missingManagersByApplication',
      kind: 'issue',
      title: 'Missing managers (by linked application)',
      involved: missingManagerApps.length > 0,
      count: missingManagerApps.length,
      severity: 'MEDIUM',
      detail: missingManagerApps.length
        ? `No manager on: ${list(missingManagerApps)}`
        : 'All linked accounts have a manager value.',
      deepLink: '/datahygine/missingManagersByApplication',
    },
    {
      id: 'managerMismatches',
      kind: 'issue',
      title: 'Manager mismatches',
      involved: managerMismatchApps.length > 0,
      count: managerMismatchApps.length,
      severity: 'LOW',
      detail: managerMismatchApps.length
        ? `Account manager differs on: ${list(managerMismatchApps)}`
        : 'Account managers match the identity manager.',
      deepLink: '/datahygine/managerMismatches',
    },
    {
      id: 'inactiveUsersWithAccess',
      kind: 'issue',
      title: 'Inactive users with access',
      involved: inactiveAccessApps.length > 0,
      count: inactiveAccessApps.length,
      severity: 'HIGH',
      detail: inactiveAccessApps.length
        ? `Inactive but entitled on: ${list(inactiveAccessApps)}`
        : 'No inactive accounts retain access.',
      deepLink: '/datahygine/inactiveUsersWithAccess',
    },
    {
      id: 'privilegedEntitlements',
      kind: 'issue',
      title: 'Privileged entitlements',
      involved: privilegedCount > 0,
      count: privilegedCount,
      severity: privilegedCount >= 5 ? 'HIGH' : 'MEDIUM',
      detail: privilegedCount
        ? `Holds ${privilegedCount} privileged entitlement${privilegedCount === 1 ? '' : 's'}.`
        : 'No privileged entitlements held.',
      deepLink: '/datahygine/privilegedEntitlements',
    },
    {
      id: 'duplicateAccountsByApplication',
      kind: 'issue',
      title: 'Duplicate accounts',
      involved: duplicateApps.length > 0,
      count: duplicateApps.length,
      severity: 'MEDIUM',
      detail: duplicateApps.length
        ? `Multiple accounts on: ${list(duplicateApps.map((a) => a.name))}`
        : 'One account per linked application.',
      deepLink: '/datahygine/duplicateAccountsByApplication',
    },
    {
      id: 'orphanedProfiles',
      kind: 'issue',
      title: 'Orphaned Accounts',
      involved: relatedOrphans > 0,
      count: relatedOrphans,
      severity: 'MEDIUM',
      detail: relatedOrphans
        ? `${relatedOrphans} uncorrelated account${relatedOrphans === 1 ? '' : 's'} match this email.`
        : 'No uncorrelated accounts match this identity.',
      deepLink: '/datahygine/orphanedProfiles',
    },
    {
      id: 'sodPoliciesViolations',
      kind: 'issue',
      title: 'SoD policies & violations',
      involved: openSodCount > 0,
      count: openSodCount,
      severity: 'HIGH',
      detail: openSodCount
        ? `${openSodCount} open segregation-of-duties conflict${openSodCount === 1 ? '' : 's'}.`
        : 'No open SoD conflicts.',
      deepLink: '/governance/sod-violations',
    },
    {
      id: 'accessCertificationCampaigns',
      kind: 'info',
      title: 'Access certification',
      involved: certCount > 0,
      count: certCount,
      severity: 'LOW',
      detail: certCount
        ? `Included in ${certCount} certification review item${certCount === 1 ? '' : 's'}.`
        : 'Not included in any certification campaign.',
      deepLink: '/governance/certifications/access',
    },
    {
      id: 'entitlementsMissingOwner',
      kind: 'info',
      title: 'Entitlements missing owner',
      involved: totalEntitlements > 0,
      count: totalEntitlements,
      severity: 'LOW',
      detail: totalEntitlements
        ? `${totalEntitlements} entitlement${totalEntitlements === 1 ? '' : 's'} across linked applications.`
        : 'No entitlements detected.',
      deepLink: '/datahygine/entitlementsMissingOwner',
    },
  ];

  const issueChecks = catalog.filter((c) => c.kind === 'issue');
  const involvedChecks = issueChecks.filter((c) => c.involved);

  const summary = {
    hygieneScore: Math.round(hygieneScore),
    totalChecks: issueChecks.length,
    involvedChecks: involvedChecks.length,
    cleanChecks: issueChecks.length - involvedChecks.length,
    attributeGaps: attributeGaps.length,
    managerIssues: missingManagerApps.length + managerMismatchApps.length + (identityHasManager ? 0 : 1),
    inactiveAccess: inactiveAccessApps.length,
    privilegedFlags: privilegedCount,
    totalFindings: involvedChecks.length,
  };

  return {
    identityId: String(identity._id),
    summary,
    attributeChecks: attributeChecks || [],
    catalog,
    deepLink: '/datahygine',
  };
}

/**
 * GET /identities/:id/privileges
 * Privileged accounts and entitlements held by this identity.
 */
export async function buildIdentityPrivilegeInsights(identityId, scopedTenantId) {
  const { identity, tenantId } = await loadIdentityDocument(identityId, scopedTenantId);
  const inventory = await loadAccessInventoryByApplication(identityId, tenantId);

  const accounts = (inventory.linkedAccounts || []).filter(
    (a) => a.isPrivileged || (a.privilegedEntitlements || 0) > 0,
  );

  const items = [];
  for (const acc of accounts) {
    const names = Array.isArray(acc.privilegedNames) ? acc.privilegedNames : [];
    if (names.length) {
      for (const name of names) {
        items.push({
          id: `${acc.applicationId || acc.applicationName}:${acc.accountName}:${name}`,
          entitlementName: name,
          applicationName: acc.applicationName || 'Application',
          applicationId: acc.applicationId || null,
          accountName: acc.accountName || '—',
          kind: 'entitlement',
          severity: 'MEDIUM',
        });
      }
    } else if (acc.isPrivilegedAccount || acc.isPrivileged) {
      items.push({
        id: `acct:${acc.applicationId || acc.applicationName}:${acc.accountName}`,
        entitlementName: 'Privileged account',
        applicationName: acc.applicationName || 'Application',
        applicationId: acc.applicationId || null,
        accountName: acc.accountName || '—',
        kind: 'account',
        severity: 'HIGH',
      });
    }
  }

  const byApplication = (inventory.byApplication || [])
    .filter((row) => (row.privilegedEntitlements || 0) > 0 || (row.privilegedCount || 0) > 0)
    .map((row) => ({
      id: row.applicationId || row.applicationName,
      applicationId: row.applicationId || null,
      applicationName: row.applicationName,
      accounts: row.accounts || 0,
      entitlements: row.entitlements || 0,
      privilegedEntitlements: row.privilegedEntitlements || 0,
      privilegedNames: row.privilegedEntitlementNames || [],
    }));

  const privilegedAccountCount = accounts.filter(
    (a) => a.isPrivilegedAccount || a.isPrivileged,
  ).length;

  return {
    identityId: String(identity._id),
    email: identity.email || null,
    summary: {
      privilegedEntitlements: inventory.totals?.privilegedEntitlementCount || 0,
      privilegedAccounts: privilegedAccountCount,
      applicationsWithPrivilege: byApplication.length,
      totalAccounts: inventory.totals?.totalAccounts || 0,
      totalEntitlements: inventory.totals?.totalEntitlements || 0,
      itemCount: items.length,
    },
    byApplication,
    accounts,
    items,
    deepLink: '/datahygine/privilegedEntitlements',
  };
}
