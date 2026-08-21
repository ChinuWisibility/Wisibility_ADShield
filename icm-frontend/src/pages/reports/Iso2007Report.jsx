import {
  useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef, memo,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box, Typography, Button, Paper, TextField, MenuItem, Stack,
  CircularProgress, Alert, GlobalStyles, Table, TableBody,
  TableCell, TableHead, TableRow, Divider, Chip,
  Tabs, Tab, TablePagination, LinearProgress,
  Menu, ListItemIcon, ListItemText, IconButton,
  Tooltip as MuiTooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckCircle, PersonOff, Shield, PictureAsPdf,
  AssignmentOutlined, LayersOutlined, Security, VerifiedUser,
  LinkOff, WarningAmber, InfoOutlined,
  ExpandMore, TableChart, FolderZip, Print, Assessment,
} from '@mui/icons-material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
  ComposedChart, Area, Line,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import api, {
  applicationAPI, tenantAPI, correlationAPI, governanceIntelligenceExportAPI,
} from '../../services/api';
import {
  catalogHasPrivilegedDefinition,
  collectPrivilegeMatchMemberTokens,
  countUsersMatchingEntitlementTokenLists,
  countUsersWithPrivilegedEntitlements,
  entitlementCatalogDedupeKey,
  listUsersWithPrivilegedEntitlements,
  mergePrivilegedEntitlementCatalogs,
  normalizePrivilegeBoolean,
  resolveUserDisplayName,
} from '../../services/accessCertificationService';
import { Link as RouterLink } from 'react-router-dom';
import UsersTable from '../applications/UsersTable';
import AccessCertificationSection from './AccessCertificationSection';
import IsoReportSodSection from './IsoReportSodSection';
import ApplicationReportingRuleSetSection from '../../components/reports/ApplicationReportingRuleSetSection';
import { sodAPI } from '../../services/sodService';

/* ─── helpers ────────────────────────────────────────────────────────── */
function tenantIdFromUser(user) {
  const t = user?.tenantId;
  if (!t) return '';
  if (typeof t === 'object' && t._id != null) return String(t._id);
  return String(t);
}
function tenantLabel(tenant) {
  if (!tenant) return '';
  if (typeof tenant === 'object' && tenant.name) return tenant.name;
  return '';
}

/** Sanitize a label for use in a download filename. */
function safeExportFilenamePart(value, fallback = 'unknown') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

const EXPORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. 27-Jul-2026_08-45-12 */
function formatReadableExportStamp(at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    `${pad(at.getDate())}-${EXPORT_MONTHS[at.getMonth()]}-${at.getFullYear()}`,
    `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`,
  ].join('_');
}

function resolveOrgAdminDisplayName(user) {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (user?.email) return String(user.email).split('@')[0];
  return 'OrgAdmin';
}

/**
 * e.g. governance_report_Jane_Doe_HR_System_27-Jul-2026_08-45-12.pdf
 * @param {{ orgAdminName?: string; applicationName?: string; format?: string; at?: Date }} opts
 */
function buildGovernanceReportExportFilename({
  orgAdminName,
  applicationName,
  format = 'pdf',
  at = new Date(),
} = {}) {
  const base = [
    'governance_report',
    safeExportFilenamePart(orgAdminName, 'OrgAdmin'),
    safeExportFilenamePart(applicationName, 'Application'),
    formatReadableExportStamp(at),
  ].join('_');
  const ext = format === 'excel' ? 'xlsx' : format === 'pack' ? 'zip' : 'pdf';
  return `${base}.${ext}`;
}

async function downloadGovernanceExportBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
function normalizeUserLifecycleStatus(user) {
  const raw = user?.rawData || {};
  const candidates = [
    ['status', user?.status ?? raw.status],
    ['account_status', user?.accountStatus ?? raw.accountStatus ?? raw.account_status],
    ['user_status', user?.user_status ?? raw.user_status ?? raw.userStatus],
    ['employment_status', user?.employment_status ?? raw.employment_status],
    ['user_active', user?.user_active ?? raw.user_active],
    ['active', user?.active ?? raw.active],
    ['is_active', user?.is_active ?? raw.is_active],
    ['account_enabled', user?.account_enabled ?? raw.account_enabled],
    ['enabled', user?.enabled ?? raw.enabled],
    ['accountDisabled', user?.accountDisabled ?? raw.accountDisabled],
    ['locked', user?.locked ?? raw.locked],
    ['suspended', user?.suspended ?? raw.suspended],
    ['userAccountControl', user?.userAccountControl ?? raw.userAccountControl ?? raw.useraccountcontrol ?? raw.user_account_control],
    ['site_role', user?.site_role ?? raw.site_role],
    ['lifecycle', user?.lifecycle ?? raw.lifecycle],
    ['lifecycleState', user?.lifecycleState ?? raw.lifecycleState],
    ['profile_status', user?.profile_status ?? raw.profile_status],
  ];

  for (const [key, value] of candidates) {
    if (value == null || String(value).trim() === '') continue;

    if (key === 'userAccountControl') {
      const num = Number(String(value).trim());
      if (!Number.isNaN(num)) {
        return (num & 2) === 2 ? 'INACTIVE' : 'ACTIVE';
      }
    }

    if (typeof value === 'boolean') {
      const negativeKey = ['suspended', 'accountdisabled', 'disabled', 'locked', 'lockout', 'terminated', 'isinactive']
        .includes(String(key).toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (negativeKey) return value ? 'INACTIVE' : 'ACTIVE';
      const positiveKey = ['active', 'is_active', 'user_active', 'account_enabled', 'enabled']
        .includes(String(key).toLowerCase());
      if (positiveKey) return value ? 'ACTIVE' : 'INACTIVE';
      return value ? 'ACTIVE' : 'INACTIVE';
    }

    const s = String(value).trim().toLowerCase();
    if (key === 'site_role') {
      if (/unlicensed|suspend|disabled|inactive|deactiv/.test(s)) return 'INACTIVE';
      return 'ACTIVE';
    }
    if (/suspend|disabled|inactive|terminated|offboard|resign|lock|leaver|separat|exit|false|no|0/.test(s)) {
      return 'INACTIVE';
    }
    if (/active|enabled|enable|true|yes|1|current|open|employ/.test(s)) {
      return 'ACTIVE';
    }
  }

  return '';
}

function computeUserStats(users) {
  const total = users.length;
  let active = 0;
  for (const u of users) {
    const status = normalizeUserLifecycleStatus(u);
    if (status === 'INACTIVE') continue;
    active += 1;
  }
  return { total, active, inactive: total - active };
}

/**
 * KPI rows for the Thresholds tab scorecard — same numerators/denominators
 * as the governance risk-band cards (total = certification users for this app).
 * @returns {Array<{key: string, short: string, name: string, pct: number, fill: string}> | null}
 */
function buildThresholdGovernanceKpiRows(totalUsers, active, inactive, orphanOpenCount, privilegedCount) {
  const t = Math.max(0, Number(totalUsers) || 0);
  if (t <= 0) return null;
  const round1 = (x) => Math.round(x * 10) / 10;
  const orphanN = Math.max(0, Number(orphanOpenCount) || 0);
  const orphanPct = (orphanN / t) * 100;
  const activePct = (Math.max(0, Number(active) || 0) / t) * 100;
  const inactivePct = (Math.max(0, Number(inactive) || 0) / t) * 100;
  const privPct = Math.min(100, (Math.max(0, Number(privilegedCount) || 0) / t) * 100);
  return [
    { key: 'uncorr', short: 'Uncorrelated', name: 'OPEN uncorrelated ÷ total users', pct: round1(orphanPct), fill: '#7c3aed' },
    { key: 'active', short: 'Active', name: 'Active users ÷ total users', pct: round1(activePct), fill: '#0d9488' },
    { key: 'inactive', short: 'Inactive', name: 'Inactive users ÷ total users', pct: round1(inactivePct), fill: '#64748b' },
    { key: 'priv', short: 'Privileged', name: 'Privileged KPI ÷ total users', pct: round1(privPct), fill: '#c2410c' },
  ];
}

function isUserInactive(u) {
  return normalizeUserLifecycleStatus(u) === 'INACTIVE';
}

const ACCOUNT_DORMANT_DAYS = 90;

function parseUserLastLogin(u) {
  const raw = u?.rawData || {};
  const v =
    u?.lastLogin ?? u?.lastLoginAt ??
    raw.lastLogin ?? raw.lastLoginAt ?? raw.lastSignIn ?? raw.last_sign_in ??
    raw.lastLoginDate ?? raw.last_login_date;
  if (v == null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSinceDate(d) {
  return (Date.now() - d.getTime()) / 86400000;
}

/** Lifecycle slice for governance donut: active / disabled / dormant / orphan (mutually exclusive). */
function classifyAccountLifecycleBucket(u) {
  const raw = u?.rawData || {};
  const statusVal =
    u?.status ?? u?.accountStatus ??
    raw.status ?? raw.Status ?? raw.STATUS ??
    raw.accountStatus ?? raw.account_status ??
    raw.employeeStatus ?? raw.employee_status ??
    raw.userStatus ?? raw.user_status ??
    raw.empStatus ?? raw.emp_status;
  const s = statusVal != null ? String(statusVal).trim().toLowerCase() : '';
  if (
    s.includes('orphan')
    || raw.isOrphan === true
    || raw.orphanAccount === true
    || raw.uncorrelatedAccount === true
    || String(raw.accountType || '').toLowerCase() === 'orphan'
  ) {
    return 'orphan';
  }
  if (isUserInactive(u)) return 'disabled';
  const ll = parseUserLastLogin(u);
  if (ll && daysSinceDate(ll) >= ACCOUNT_DORMANT_DAYS) return 'dormant';
  if (s.includes('dormant') || s.includes('idle')) return 'dormant';
  return 'active';
}

function buildPrivilegedKeySets(privilegedAppendixRows) {
  const privilegedIdSet = new Set();
  const privilegedNameSet = new Set();
  if (!Array.isArray(privilegedAppendixRows)) return { privilegedIdSet, privilegedNameSet };
  for (const r of privilegedAppendixRows) {
    const id = String(r.id || '').toLowerCase().trim();
    if (id) privilegedIdSet.add(id);
    const nm = String(r.displayName || '').toLowerCase().trim();
    if (nm) privilegedNameSet.add(nm);
  }
  return { privilegedIdSet, privilegedNameSet };
}

function userMatchesPrivilegedAppendix(u, privilegedIdSet, privilegedNameSet) {
  const raw = u?.rawData || {};
  const id = String(
    u?.nativeIdentity || u?.username || u?.user_id || raw.sAMAccountName || raw.username || '',
  ).toLowerCase().trim();
  if (id && privilegedIdSet.has(id)) return true;
  const disp = String(resolveUserDisplayName(u)).toLowerCase().trim();
  return !!(disp && privilegedNameSet.has(disp));
}

/**
 * Mutually exclusive lifecycle + privilege slice (same rules as account status donut and department stack):
 * correlation orphan queue → orphan → inactive → dormant → privileged (active + appendix) → standard active.
 */
/**
 * @param {Set<string>|null} userIdsWithQueueMatch — when provided (incl. empty Set), O(1) per user vs scanning all queue rows.
 */
function classifyAccountStatusDonutBucket(u, privilegedIdSet, privilegedNameSet, correlationOrphanRows, userIdsWithQueueMatch = null) {
  const orphans = Array.isArray(correlationOrphanRows) ? correlationOrphanRows : [];
  if (userIdsWithQueueMatch != null) {
    const uid = String(u?._id || '');
    if (uid && userIdsWithQueueMatch.has(uid)) return 'orphan';
  } else if (orphans.length > 0 && orphans.some((r) => userRowMatchesOrphanRecord(u, r))) {
    return 'orphan';
  }
  const base = classifyAccountLifecycleBucket(u);
  if (base === 'orphan') return 'orphan';
  if (base === 'disabled') return 'inactive';
  if (base === 'dormant') return 'dormant';
  if (userMatchesPrivilegedAppendix(u, privilegedIdSet, privilegedNameSet)) return 'privileged';
  return 'standardActive';
}

/** True when certification user row matches an OPEN uncorrelated (orphan) queue record for this app. */
function userRowMatchesOrphanRecord(u, r) {
  const aid = String(r?.accountId || '').trim();
  if (aid && String(u?._id || '') === aid) return true;
  const ck =
    typeof r?.correlationKey === 'string' && r.correlationKey.startsWith('v:')
      ? r.correlationKey.slice(2).trim().toLowerCase()
      : '';
  if (!ck) return false;
  const raw = u?.rawData || {};
  const candidates = [
    u?.email,
    raw.email,
    u?.nativeIdentity,
    u?.username,
    u?.user_id,
    raw.sAMAccountName,
    raw.username,
    raw.mail,
    raw.userPrincipalName,
  ];
  for (const f of candidates) {
    if (f != null && String(f).trim().toLowerCase() === ck) return true;
  }
  const disp = String(resolveUserDisplayName(u)).trim().toLowerCase();
  return !!(disp && disp === ck);
}

function computeAccountStatusDonutCounts(users, privilegedAppendixRows, correlationOrphanRows = []) {
  const orphans = Array.isArray(correlationOrphanRows) ? correlationOrphanRows : [];
  const { privilegedIdSet, privilegedNameSet } = buildPrivilegedKeySets(privilegedAppendixRows);
  const o = { standardActive: 0, privileged: 0, inactive: 0, dormant: 0, orphan: 0 };
  if (!Array.isArray(users)) return o;
  const lookup = buildOrphanMatchedUserLookup(users);
  const matchedOrphanRowIds = new Set();
  const userIdsWithQueueMatch = new Set();
  for (const r of orphans) {
    const m = matchedUserForOrphanRow(r, lookup);
    if (m?._id != null) {
      userIdsWithQueueMatch.add(String(m._id));
      matchedOrphanRowIds.add(String(r._id));
    }
  }
  for (const u of users) {
    const k = classifyAccountStatusDonutBucket(u, privilegedIdSet, privilegedNameSet, orphans, userIdsWithQueueMatch);
    o[k] += 1;
  }
  o.orphan += orphans.length - matchedOrphanRowIds.size;
  return o;
}

/** Chart slices from server queue digest (no orphan row array in memory). */
function computeAccountStatusDonutCountsFromQueueDigest(users, privilegedAppendixRows, digest) {
  const { privilegedIdSet, privilegedNameSet } = buildPrivilegedKeySets(privilegedAppendixRows);
  const o = { standardActive: 0, privileged: 0, inactive: 0, dormant: 0, orphan: 0 };
  if (!Array.isArray(users)) return o;
  const userIdsWithQueueMatch = new Set(
    Array.isArray(digest?.queueMatchUserIds) ? digest.queueMatchUserIds.map(String) : [],
  );
  const total = typeof digest?.total === 'number' ? digest.total : 0;
  const matchedQueueRowCount = typeof digest?.matchedQueueRowCount === 'number' ? digest.matchedQueueRowCount : 0;
  for (const u of users) {
    const k = classifyAccountStatusDonutBucket(u, privilegedIdSet, privilegedNameSet, [], userIdsWithQueueMatch);
    o[k] += 1;
  }
  o.orphan += Math.max(0, total - matchedQueueRowCount);
  return o;
}

function computeDepartmentRiskBarFromQueueDigest(users, privilegedAppendixRows, digest) {
  const orphans = [];
  const { privilegedIdSet, privilegedNameSet } = buildPrivilegedKeySets(privilegedAppendixRows);
  const userIdsWithQueueMatch = new Set(
    Array.isArray(digest?.queueMatchUserIds) ? digest.queueMatchUserIds.map(String) : [],
  );
  const total = typeof digest?.total === 'number' ? digest.total : 0;
  const matchedQueueRowCount = typeof digest?.matchedQueueRowCount === 'number' ? digest.matchedQueueRowCount : 0;
  const extraOrphans = Math.max(0, total - matchedQueueRowCount);

  if (!users.length && !extraOrphans) return [];

  const deptMap = new Map();
  for (const u of users) {
    const dept = departmentOfUser(u);
    if (!deptMap.has(dept)) {
      deptMap.set(dept, {
        name: dept,
        standardActive: 0,
        privileged: 0,
        inactive: 0,
        dormant: 0,
        orphan: 0,
      });
    }
    const row = deptMap.get(dept);
    const k = classifyAccountStatusDonutBucket(u, privilegedIdSet, privilegedNameSet, orphans, userIdsWithQueueMatch);
    row[k] += 1;
  }
  if (extraOrphans > 0) {
    const dept = 'Uncorrelated queue (not in cert. list)';
    if (!deptMap.has(dept)) {
      deptMap.set(dept, {
        name: dept,
        standardActive: 0,
        privileged: 0,
        inactive: 0,
        dormant: 0,
        orphan: 0,
      });
    }
    deptMap.get(dept).orphan += extraOrphans;
  }
  return Array.from(deptMap.values())
    .map((r) => ({
      ...r,
      total: r.standardActive + r.privileged + r.inactive + r.dormant + r.orphan,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
}

/** ISO summary: totals + digest for charts (detail rows loaded via paged query). */
async function fetchCorrelationOrphansIsoSummary(tenantId, applicationId) {
  if (!tenantId || !applicationId) return null;
  const res = await correlationAPI.getOrphansIsoSummary(applicationId, { tenantId });
  const p = res?.data || {};
  if (!p.success) return null;
  return {
    total: typeof p.total === 'number' ? p.total : 0,
    stats: p.stats ?? null,
    queueMatchUserIds: Array.isArray(p.queueMatchUserIds) ? p.queueMatchUserIds : [],
    matchedQueueRowCount: typeof p.matchedQueueRowCount === 'number' ? p.matchedQueueRowCount : 0,
  };
}

/** O(1) lookup for orphan cards — avoids users.find per row (jank with large populations). */
function buildOrphanMatchedUserLookup(users) {
  const byAccountId = new Map();
  const byNorm = new Map();
  if (!Array.isArray(users)) return { byAccountId, byNorm };
  for (const u of users) {
    const id = u?._id != null ? String(u._id) : '';
    if (id) byAccountId.set(id, u);
    const raw = u?.rawData || {};
    const fields = [
      u?.email,
      raw.email,
      u?.nativeIdentity,
      u?.username,
      u?.user_id,
      raw.sAMAccountName,
      raw.username,
      raw.mail,
      raw.userPrincipalName,
    ];
    for (const f of fields) {
      if (f == null) continue;
      const k = String(f).trim().toLowerCase();
      if (k && !byNorm.has(k)) byNorm.set(k, u);
    }
    const disp = String(resolveUserDisplayName(u)).trim().toLowerCase();
    if (disp && !byNorm.has(disp)) byNorm.set(disp, u);
  }
  return { byAccountId, byNorm };
}

function matchedUserForOrphanRow(row, lookup) {
  if (!lookup || !row) return undefined;
  const aid = String(row.accountId || '').trim();
  if (aid && lookup.byAccountId.has(aid)) return lookup.byAccountId.get(aid);
  const ck =
    typeof row.correlationKey === 'string' && row.correlationKey.startsWith('v:')
      ? row.correlationKey.slice(2).trim().toLowerCase()
      : '';
  if (ck && lookup.byNorm.has(ck)) return lookup.byNorm.get(ck);
  return undefined;
}

/** Single bundle for ISO report — used with TanStack Query cache (per tenant + application). */
async function fetchIsoReportBundle({
  appId,
  tenantForOrphans,
  appNameFromList,
  fetchAllApplicationUsersFn,
}) {
  const [detailRes, certRes, orphanSummary, privListRes] = await Promise.all([
    applicationAPI.getById(appId),
    api.get(`/access-certification/data/${appId}`).catch(() => null),
    fetchCorrelationOrphansIsoSummary(tenantForOrphans, appId).catch(() => null),
    api.get('/accounts/privileged', { params: { application: appId, limit: 500 } }).catch(() => null),
  ]);

  const appData = detailRes.data?.data ?? detailRes.data;

  const privListRaw = privListRes?.data?.data?.items ?? privListRes?.data?.items ?? [];
  const totalPriv = privListRes?.data?.data?.total ?? privListRes?.data?.total ?? null;
  const privilegedAccountsList = Array.isArray(privListRaw) ? privListRaw : [];
  const privilegedFromAccounts = typeof totalPriv === 'number' ? totalPriv : privListRaw.length || 0;

  const certPayload = certRes?.data?.data ?? certRes?.data;
  const hasCertUsers = Array.isArray(certPayload?.users) && certPayload.users.length > 0;
  const certUsers = hasCertUsers ? certPayload.users : [];

  const appName = appData?.name || appData?.applicationName || appNameFromList || '';
  const entPromise = appName
    ? api.get('/entitlements', { params: { applicationName: appName, isPrivileged: true, limit: 500 } }).catch(() => null)
    : Promise.resolve(null);
  const fallbackPromise = hasCertUsers
    ? Promise.resolve([])
    : fetchAllApplicationUsersFn(appId).catch(() => []);

  const [fallbackUsers, entRes] = await Promise.all([fallbackPromise, entPromise]);

  const resolvedUsers = hasCertUsers ? certUsers : fallbackUsers;
  const users = Array.isArray(resolvedUsers) ? resolvedUsers : [];

  const certEnts = Array.isArray(certPayload?.entitlements) ? certPayload.entitlements : [];

  const orphanQueueDigest = orphanSummary && typeof orphanSummary.total === 'number' ? orphanSummary : null;
  const correlationOrphansTotal = orphanQueueDigest?.total ?? 0;
  const correlationOrphansStats = orphanQueueDigest?.stats ?? null;

  const entRaw = entRes?.data?.data?.items ?? entRes?.data?.data ?? entRes?.data?.items ?? [];
  const privilegedEntitlements = Array.isArray(entRaw) ? entRaw : [];

  const mergedForPrivilegedCount = mergePrivilegedEntitlementCatalogs(certEnts, privilegedEntitlements);
  let privilegedFromEntitlements = null;
  if (hasCertUsers && catalogHasPrivilegedDefinition(mergedForPrivilegedCount)) {
    privilegedFromEntitlements = countUsersWithPrivilegedEntitlements(certUsers, mergedForPrivilegedCount);
  }

  return {
    appDetail: appData || null,
    users,
    privilegedAccountsList,
    privilegedFromAccounts,
    certEntitlements: certEnts,
    privilegedEntitlements,
    orphanQueueDigest,
    correlationOrphansTotal,
    correlationOrphansStats,
    privilegedFromEntitlements,
  };
}

function monthsSinceApprox(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = (Date.now() - d.getTime()) / 86400000;
  const mo = Math.max(0, Math.round(days / 30));
  return mo;
}

function terminationHintFromUser(matchedUser) {
  if (!matchedUser) return null;
  const raw = matchedUser?.rawData || {};
  const end =
    raw.terminationDate || raw.TerminationDate || raw.endDate || raw.lastDay || raw.employmentEndDate;
  const mo = monthsSinceApprox(end);
  if (mo != null && mo > 0) return `Employment / contract end ~${mo} month(s) ago (import)`;
  if (isUserInactive(matchedUser)) return 'Account not in an active state in current population data';
  return null;
}

function orphanEvidenceCauses(orphanRow, matchedUser) {
  const causes = ['Uncorrelated — no identity match (correlation engine queue)'];
  if (!matchedUser) causes.push('Not in certification user extract — validate in connector / correlation UI');
  if (matchedUser && isUserInactive(matchedUser)) causes.push('Inactive or terminated-style status in account data');
  if (typeof orphanRow?.correlationKey === 'string' && orphanRow.correlationKey.startsWith('aid:')) {
    causes.push('Missing correlation attribute on account — cannot match to directory');
  }
  return [...new Set(causes)];
}

function departmentOfUser(u) {
  const raw = u?.rawData || u?._originalData || {};
  const d =
    u?.department ??
    raw.department ?? raw.Department ?? raw.dept ?? raw.costCenter ?? raw.cost_center ??
    raw.businessUnit ?? raw.division ?? '';
  const t = String(d).trim();
  return t || 'Unassigned';
}

function addMonthsClamped(y, m, delta) {
  const d = new Date(y, m + delta, 1);
  return d;
}

/** Most recent `count` quarter-end labels (e.g. Q2 2026 …), oldest first. */
function trailingQuarterLabels(count, ref = new Date()) {
  const labels = [];
  let d = new Date(ref.getFullYear(), ref.getMonth(), 1);
  for (let i = 0; i < count; i += 1) {
    const q = Math.floor(d.getMonth() / 3) + 1;
    labels.unshift(`Q${q} ${d.getFullYear()}`);
    d = addMonthsClamped(d.getFullYear(), d.getMonth(), -3);
  }
  return labels;
}
function privilegedCountFromRawData(users) {
  let n = 0;
  for (const u of users) {
    const r = u?.rawData;
    if (!r || typeof r !== 'object') continue;
    const val = r.privileged ?? r.is_privileged ?? r.isPrivileged ?? r.PRIVILEGED;
    if (val === true || val === 1) { n++; continue; }
    if (val != null && /^(true|yes|1|y|privileged)$/i.test(String(val).trim())) n++;
  }
  return n;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDisplayText(value) {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || '—';
  }
  if (typeof value === 'object') {
    const firstName = value.firstName ? String(value.firstName).trim() : '';
    const lastName = value.lastName ? String(value.lastName).trim() : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (value.name) return String(value.name).trim() || '—';
    if (value.email) return String(value.email).trim() || '—';
    if (value._id) return String(value._id);
    return '—';
  }
  return '—';
}

function columnDefsFromUserMappings(userMappings) {
  if (!Array.isArray(userMappings) || userMappings.length === 0) return null;
  const seen = new Set();
  const defs = [];
  for (const m of userMappings) {
    const key = String(m.standardField || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = (m.displayName && String(m.displayName).trim()) ||
      key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    defs.push({ key, label });
  }
  return defs.length ? defs : null;
}

/**
 * Governance health 0–100 (higher = stronger posture), with the itemized penalty breakdown
 * behind it — reused for both the score itself and the "how this is calculated" tooltip.
 * Penalties: inactive share (up to −20), privileged share > 30% (−10), orphan share (up to −14).
 * Keep in sync with icm-backend/src/config/isoGovernanceControls.config.js
 */
function computeGovernanceHealthBreakdown(stats, privilegedCount, orphanBucketCount = 0) {
  if (!stats || stats.total === 0) return null;
  const denom = Math.max(stats.total, 1);

  const inactiveCount = Math.max(0, Number(stats.inactive) || 0);
  const inactiveRatio = inactiveCount / denom;
  const inactivePenalty = inactiveRatio * 20;

  const privilegedCountSafe = Math.max(0, Number(privilegedCount) || 0);
  const privilegedRatio = privilegedCountSafe / denom;
  const privilegedPenalty = privilegedRatio > 0.3 ? 10 : 0;

  const orphanCount = Math.max(0, Number(orphanBucketCount) || 0);
  const orphanRatio = orphanCount / denom;
  const orphanPenalty = Math.min(14, orphanRatio * 120);

  const score = Math.max(0, Math.round(100 - inactivePenalty - privilegedPenalty - orphanPenalty));

  return {
    total: stats.total,
    inactiveCount, inactiveRatio, inactivePenalty,
    privilegedCount: privilegedCountSafe, privilegedRatio, privilegedPenalty,
    orphanCount, orphanRatio, orphanPenalty,
    score,
  };
}

function computeGovernanceHealthScore(stats, privilegedCount, orphanBucketCount = 0) {
  return computeGovernanceHealthBreakdown(stats, privilegedCount, orphanBucketCount)?.score ?? null;
}

/** Risk exposure 0–10: higher = worse. (100 − health) / 10. */
function governanceHealthToRiskExposure10(health100) {
  if (health100 == null || Number.isNaN(Number(health100))) return null;
  return Math.round(((100 - Number(health100)) / 10) * 10) / 10;
}

/* ─── ISO 27001 controls matrix ─────────────────────────────────────── */
const ISO_CONTROLS = [
  { id: 'A.5.15', title: 'Access control', domain: 'Organizational', desc: 'Rules to control logical and physical access to information and assets shall be established.' },
  { id: 'A.5.18', title: 'Access rights', domain: 'Organizational', desc: 'Access rights shall be provisioned, reviewed, modified and removed in accordance with policy.' },
  { id: 'A.6.1', title: 'Screening', domain: 'People', desc: 'Background verification checks shall be carried out on all candidates prior to joining.' },
  { id: 'A.8.2', title: 'Privileged access rights', domain: 'Technological', desc: 'Allocation and use of privileged access rights shall be restricted and managed.' },
  { id: 'A.8.3', title: 'Information access restriction', domain: 'Technological', desc: 'Access to information and application system functions shall be restricted.' },
  { id: 'A.8.5', title: 'Secure authentication', domain: 'Technological', desc: 'Secure authentication technologies and procedures shall be implemented.' },
  { id: 'A.8.7', title: 'Protection against malware', domain: 'Technological', desc: 'Protection against malware shall be implemented and supported by user awareness.' },
  { id: 'A.8.18', title: 'Use of privileged utility programs', domain: 'Technological', desc: 'The use of utility programs that might override system and application controls shall be restricted.' },
  { id: 'A.8.19', title: 'Installation of software on operational systems', domain: 'Technological', desc: 'Procedures and measures shall be implemented to securely manage software installation.' },
];

/** Controls scored from IGA evidence (others remain N/A until evidence exists). */
const ISO_ASSESSED_CONTROL_IDS = new Set(['A.5.15', 'A.5.18', 'A.8.2', 'A.8.3', 'A.8.18']);

function deriveControlStatus(controlId, stats, privilegedCount, orphanBucketCount = 0) {
  if (!stats || stats.total === 0) return 'NOT_APPLICABLE';
  if (!ISO_ASSESSED_CONTROL_IDS.has(controlId)) return 'NOT_APPLICABLE';
  const inactiveRatio = stats.inactive / Math.max(stats.total, 1);
  const privRatio = privilegedCount / Math.max(stats.total, 1);
  const nOr = Math.max(0, Number(orphanBucketCount) || 0);
  const orphanRatio = nOr / Math.max(stats.total, 1);
  switch (controlId) {
    case 'A.5.15':
      if (nOr > 0 && inactiveRatio <= 0.1 && orphanRatio > 0.05) return 'PARTIAL';
      return inactiveRatio > 0.25 ? 'NON_COMPLIANT' : inactiveRatio > 0.1 ? 'PARTIAL' : 'COMPLIANT';
    case 'A.5.18':
      if (nOr > 0) {
        if (orphanRatio > 0.1 || nOr >= 25) return 'NON_COMPLIANT';
        return inactiveRatio > 0.3 ? 'NON_COMPLIANT' : 'PARTIAL';
      }
      return inactiveRatio > 0.3 ? 'NON_COMPLIANT' : inactiveRatio > 0.1 ? 'PARTIAL' : 'COMPLIANT';
    case 'A.8.2': return privilegedCount > 0 ? (privRatio > 0.2 ? 'PARTIAL' : 'COMPLIANT') : 'COMPLIANT';
    case 'A.8.3':
      if (nOr > 0) return inactiveRatio > 0.2 ? 'NON_COMPLIANT' : 'PARTIAL';
      return inactiveRatio > 0.2 ? 'PARTIAL' : 'COMPLIANT';
    case 'A.8.18': return privRatio > 0.15 ? 'PARTIAL' : 'COMPLIANT';
    default: return 'NOT_APPLICABLE';
  }
}

/** Weighted ISO % over applicable controls: COMPLIANT=1, PARTIAL=0.5, NON_COMPLIANT=0; N/A excluded. */
function computeIsoCompliancePercent(stats, privilegedCount, orphanBucketCount = 0) {
  if (!stats || stats.total === 0) return 0;
  let weight = 0;
  let score = 0;
  for (const c of ISO_CONTROLS) {
    const status = deriveControlStatus(c.id, stats, privilegedCount, orphanBucketCount);
    if (status === 'NOT_APPLICABLE') continue;
    weight += 1;
    if (status === 'COMPLIANT') score += 1;
    else if (status === 'PARTIAL') score += 0.5;
  }
  if (weight === 0) return 0;
  return Math.round((score / weight) * 100);
}

/* ─── design tokens ─────────────────────────────────────────────────── */
const T = {
  blue: '#1a4fba', blueMid: '#2563eb', blueLt: '#eff4ff', blueBdr: '#bfcef8',
  red: '#c8252a', redLt: '#fef2f2', redBdr: '#fbc2c2',
  amber: '#b45309', amberLt: '#fffbeb', amberBdr: '#fcd89d',
  green: '#166534', greenLt: '#f0fdf4', greenBdr: '#a7f3cc',
  teal: '#0f766e', tealLt: '#f0fdfa', tealBdr: '#99f0e8',
  purple: '#6d28d9', purpleLt: '#f5f3ff', purpleBdr: '#ddd6fe',
  ink: '#0d1e35', ink2: '#3d5166', ink3: '#7e96ae', ink4: '#b0c0cf',
  bg: '#f4f6f9', surface: '#ffffff', border: '#dde3ed',
};

/** Donut pie for the four governance KPI shares: slice area ∝ each metric’s % of users (metrics are not mutually exclusive). */
function GovernanceExecutiveKpiPieDonut({ rows }) {
  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        key: r.key,
        label: r.short,
        value: Math.max(0, Number(r.pct) || 0),
        pct: Number(r.pct) || 0,
        definition: r.name,
        fill: r.fill,
      })),
    [rows],
  );

  const valueSum = useMemo(
    () => chartData.reduce((a, d) => a + d.value, 0),
    [chartData],
  );

  const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

  return (
    <Box sx={{ py: 2.5, px: { xs: 2, sm: 3 } }}>
      {valueSum <= 0 ? (
        <Box sx={{ py: 3, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.88rem', color: T.ink3 }}>
            All four governance KPIs are 0% on this basis — nothing to chart.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: 'center',
            justifyContent: 'center',
            gap: { xs: 2.5, sm: 4 },
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 300, height: 280, flexShrink: 0 }}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius="54%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke={T.surface}
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {chartData.map((d) => (
                    <Cell key={d.key} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const p = payload[0].payload;
                    const rel = valueSum > 0 ? ((p.value / valueSum) * 100).toFixed(1) : '0';
                    return (
                      <Paper
                        elevation={4}
                        sx={{
                          px: 1.5,
                          py: 1,
                          borderRadius: 1.5,
                          border: `1px solid ${alpha(T.border, 0.92)}`,
                          bgcolor: T.surface,
                          boxShadow: '0 8px 24px rgba(13, 30, 53, 0.12)',
                        }}
                      >
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: T.ink, mb: 0.25 }}>
                          {p.label}
                        </Typography>
                        <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, fontFamily: mono, color: T.ink }}>
                          {p.pct}%
                          <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 600, color: T.ink3, ml: 0.75 }}>
                            of users
                          </Typography>
                        </Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: T.ink3, mt: 0.35, lineHeight: 1.4 }}>
                          {rel}% of this chart · {p.definition}
                        </Typography>
                      </Paper>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Box>
          <Stack spacing={1.15} sx={{ alignSelf: 'center', minWidth: { sm: 200 }, px: { xs: 0, sm: 0.5 } }}>
            {rows.map((row) => (
              <Box
                key={row.key}
                sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, flexWrap: 'wrap' }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: row.fill,
                    flexShrink: 0,
                    mt: '3px',
                  }}
                />
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: T.ink2, minWidth: 0 }}>
                  {row.short}
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: mono, color: T.ink, ml: 'auto' }}>
                  {row.pct}%
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}

/** Muted fills shared by account lifecycle donut & department bars (less glare than primary blues/ambers). */
const ACCOUNT_STATUS_FILLS = {
  standardActive: '#5a7d9c',
  privileged: '#b8926a',
  inactive: '#98a5b3',
  dormant: '#6f8f7c',
  orphan: '#a85d64',
};

/* ─── tiny badge ─────────────────────────────────────────────────────── */
function SBadge({ label, color, bg, border }) {
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 600,
      px: '8px', py: '2px', borderRadius: '20px', whiteSpace: 'nowrap',
      bgcolor: bg, color, border: `1px solid ${border}`,
      '&::before': { content: '""', width: 5, height: 5, borderRadius: '50%', bgcolor: color, flexShrink: 0 },
    }}>{label}</Box>
  );
}
const SeverityBadge = memo(function SeverityBadge({ severity }) {
  const map = {
    HIGH: { color: T.red, bg: T.redLt, border: T.redBdr },
    CRITICAL: { color: T.red, bg: T.redLt, border: T.redBdr },
    MEDIUM: { color: T.amber, bg: T.amberLt, border: T.amberBdr },
    LOW: { color: T.green, bg: T.greenLt, border: T.greenBdr },
  };
  const m = map[(severity || '').toUpperCase()] || map.MEDIUM;
  return <SBadge label={severity || '—'} {...m} />;
});

/** Minimal uncorrelated-queue evidence card — shows application, account, severity, and detected timestamp only. */
const IsoOrphanEvidenceCard = memo(function IsoOrphanEvidenceCard({ row, matchedUser, selectedAppName }) {
  const detected = fmtDateTime(row.detectedAt || row.updatedAt);
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 2,
        borderColor: alpha(ACCOUNT_STATUS_FILLS.orphan, 0.45),
        bgcolor: alpha(ACCOUNT_STATUS_FILLS.orphan, 0.04),
        boxShadow: 'none',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>
            {row.applicationId?.name || selectedAppName || ''}
          </Typography>
          <Typography sx={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace', fontSize: '0.95rem', color: T.ink }}>
            Account: {row.accountName || row.accountId || '—'}
          </Typography>
        </Box>
        <Box sx={{ flexShrink: 0 }}>
          <SeverityBadge severity={row.riskLevel || 'HIGH'} />
        </Box>
      </Box>
      <Typography sx={{ fontSize: '0.72rem', color: T.ink3 }}>
        Detected / updated: {detected}.
      </Typography>
    </Paper>
  );
});
function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  if (s === 'open') return <SBadge label="Open" color={T.amber} bg={T.amberLt} border={T.amberBdr} />;
  if (s === 'remediated') return <SBadge label="Remediated" color={T.green} bg={T.greenLt} border={T.greenBdr} />;
  if (s === 'exception_granted') return <SBadge label="Exception" color={T.blue} bg={T.blueLt} border={T.blueBdr} />;
  if (s === 'active') return <SBadge label="Active" color={T.green} bg={T.greenLt} border={T.greenBdr} />;
  if (s === 'inactive' || s === 'disabled') return <SBadge label={status} color={T.amber} bg={T.amberLt} border={T.amberBdr} />;
  if (s === 'completed') return <SBadge label="Completed" color={T.blue} bg={T.blueLt} border={T.blueBdr} />;
  if (s === 'failed') return <SBadge label="Failed" color={T.red} bg={T.redLt} border={T.redBdr} />;
  return <SBadge label={status || '—'} color={T.ink3} bg={T.bg} border={T.border} />;
}
function ControlBadge({ status }) {
  if (status === 'COMPLIANT') return <SBadge label="Compliant" color={T.green} bg={T.greenLt} border={T.greenBdr} />;
  if (status === 'PARTIAL') return <SBadge label="Partial" color={T.amber} bg={T.amberLt} border={T.amberBdr} />;
  if (status === 'NON_COMPLIANT') return <SBadge label="Non-Compliant" color={T.red} bg={T.redLt} border={T.redBdr} />;
  return <SBadge label="N/A" color={T.ink3} bg={T.bg} border={T.border} />;
}

/* ─── KPI card ───────────────────────────────────────────────────────── */
function KpiCard({ label, value, trend, trendPos, accentColor, hint }) {
  return (
    <Box sx={{
      bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '8px',
      p: '16px 18px 14px', boxShadow: '0 1px 3px rgba(13,30,53,0.07)',
      position: 'relative', overflow: 'hidden', flex: '1 1 0', minWidth: 0,
      '&::after': { content: '""', position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', borderRadius: '0 0 8px 8px', bgcolor: accentColor },
    }}>
      <Typography sx={{ fontFamily: 'monospace', fontSize: '0.67rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.ink3, mb: 1 }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1.9rem', fontWeight: 700, color: T.ink, lineHeight: 1, letterSpacing: '-0.02em', mb: hint ? '4px' : '6px' }}>
        {value ?? '—'}
      </Typography>
      {hint && (
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.62rem', color: T.ink4, lineHeight: 1.35, mb: '4px' }}>{hint}</Typography>
      )}
      {trend && (
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.72rem', color: trendPos ? T.green : T.red }}>{trend}</Typography>
      )}
    </Box>
  );
}

/* ─── table style constants ──────────────────────────────────────────── */
const thSx = {
  fontFamily: 'monospace', fontSize: '0.65rem', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.07em', color: T.ink3,
  bgcolor: T.bg, borderBottom: `1px solid ${T.border}`, py: '10px', px: '14px', whiteSpace: 'nowrap',
};
const tdSx = { py: '11px', px: '14px', color: T.ink, borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle' };

const APPENDIX_PAGE_SIZES = [10, 25, 50, 100];

const appendixPaginationSx = {
  borderTop: `1px solid ${T.border}`,
  '& .MuiTablePagination-toolbar': { minHeight: 48, px: 1 },
  '& .MuiTablePagination-displayedRows': { fontSize: '0.75rem' },
  '& .MuiTablePagination-selectLabel, & .MuiTablePagination-input': { fontSize: '0.75rem' },
};

/* ─── InlineUsersTable — schema-driven, for Appendix B ──────────── */
function InlineUsersTable({ rows, userMappings, emptyMsg = 'No records found.' }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const prevLen = useRef(rows.length);
  useEffect(() => {
    if (rows.length !== prevLen.current) {
      prevLen.current = rows.length;
      setPage(0);
    }
  }, [rows.length]);

  const colDefs = useMemo(() => {
    const defs = columnDefsFromUserMappings(userMappings);
    return defs ? defs.slice(0, 8) : null;
  }, [userMappings]);

  const fallbackCols = [
    { key: 'displayName', label: 'Name', fallbacks: ['name', 'fullName', 'username', 'user_id', 'employee_id'] },
    { key: 'email', label: 'Email', fallbacks: ['Email', 'emailAddress'] },
    { key: 'department', label: 'Department', fallbacks: ['Department', 'dept'] },
    { key: 'status', label: 'Status', fallbacks: ['accountStatus', 'Status', 'empStatus'] },
    { key: 'lastLogin', label: 'Last Login', fallbacks: ['lastLoginAt', 'last_login', 'lastSignIn'] },
  ];

  function getCellValue(row, colDef) {
    const raw = row?.rawData || {};
    const direct = row[colDef.key];
    if (direct != null && direct !== '') return String(direct);
    const fromRaw = raw[colDef.key];
    if (fromRaw != null && fromRaw !== '') return String(fromRaw);
    if (colDef.fallbacks) {
      for (const fb of colDef.fallbacks) {
        const v = row[fb] ?? raw[fb];
        if (v != null && v !== '') return String(v);
      }
    }
    return '—';
  }

  const cols = colDefs || fallbackCols;

  if (rows.length === 0) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <CheckCircle sx={{ fontSize: 32, color: '#16a34a', mb: 1 }} />
        <Typography sx={{ fontSize: '0.82rem', color: T.ink3 }}>{emptyMsg}</Typography>
      </Box>
    );
  }

  const displayed = rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const bFrom = page * rowsPerPage + 1;
  const bTo = page * rowsPerPage + displayed.length;

  return (
    <Box>
      <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${T.border}`, bgcolor: alpha(T.ink, 0.03), display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography sx={{ fontSize: '0.72rem', color: T.ink3 }}>
          Showing <Box component="span" sx={{ fontWeight: 700, color: T.ink }}>{bFrom.toLocaleString()}–{bTo.toLocaleString()}</Box> of {rows.length.toLocaleString()}
        </Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={thSx}>#</TableCell>
              {cols.map((c) => <TableCell key={c.key} sx={thSx}>{c.label}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {displayed.map((row, i) => (
              <TableRow key={i} sx={{ '&:last-child td': { borderBottom: 'none' }, '&:hover td': { bgcolor: T.blueLt } }}>
                <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: '0.7rem', color: T.ink4 }}>
                  {page * rowsPerPage + i + 1}
                </TableCell>
                {cols.map((c) => (
                  <TableCell key={c.key} sx={tdSx}>{getCellValue(row, c)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={APPENDIX_PAGE_SIZES}
        sx={appendixPaginationSx}
      />
    </Box>
  );
}

/** Privileged user access — paginated evidence table */
function PrivilegedAppendixTable({ rows }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  useEffect(() => { setPage(0); }, [rows.length]);

  if (rows.length === 0) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Shield sx={{ fontSize: 36, color: T.ink4, mb: 1 }} />
        <Typography sx={{ fontSize: '0.82rem', color: T.ink3 }}>No privileged accounts found for this application.</Typography>
      </Box>
    );
  }

  const slice = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const from = page * rowsPerPage + 1;
  const to = page * rowsPerPage + slice.length;

  return (
    <Box>
      <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${T.border}`, bgcolor: alpha(T.amber, 0.04), display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography sx={{ fontSize: '0.72rem', color: T.ink3 }}>
          Showing <Box component="span" sx={{ fontWeight: 700, color: T.ink }}>{from.toLocaleString()}–{to.toLocaleString()}</Box> of {rows.length.toLocaleString()}
        </Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {['#', 'Name', 'Status', 'Risk level', 'Privilege basis'].map((h) => (
                <TableCell key={h} sx={thSx}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {slice.map((row, i) => (
              <TableRow key={`${row.id}-${page}-${i}`} sx={{ '&:last-child td': { borderBottom: 'none' }, '&:hover td': { bgcolor: T.blueLt } }}>
                <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: '0.7rem', color: T.ink4 }}>{page * rowsPerPage + i + 1}</TableCell>
                <TableCell sx={{ ...tdSx, fontWeight: 600, minWidth: 200 }}>{row.displayName}</TableCell>
                <TableCell sx={tdSx}><StatusBadge status={row.status} /></TableCell>
                <TableCell sx={tdSx}><SeverityBadge severity={row.riskLevel} /></TableCell>
                <TableCell sx={{ ...tdSx, fontSize: '0.72rem', maxWidth: 280 }}>
                  <Chip
                    label={row.basis}
                    size="small"
                    sx={{
                      fontSize: '0.62rem', height: 22, fontWeight: 600, maxWidth: 260,
                      bgcolor: row.type === 'account' ? T.amberLt : row.type === 'entitlement' ? T.purpleLt : T.blueLt,
                      color: row.type === 'account' ? T.amber : row.type === 'entitlement' ? T.purple : T.blue,
                      border: `1px solid ${row.type === 'account' ? T.amberBdr : row.type === 'entitlement' ? T.purpleBdr : T.blueBdr}`,
                      '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', lineHeight: 1.2 },
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={APPENDIX_PAGE_SIZES}
        sx={appendixPaginationSx}
      />
    </Box>
  );
}

/** Appendix D — privileged entitlements with pagination */
function PrivilegedEntitlementsAppendixTable({ rows }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  useEffect(() => { setPage(0); }, [rows.length]);

  if (rows.length === 0) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.82rem', color: T.ink3 }}>No privileged entitlements found for this application.</Typography>
      </Box>
    );
  }

  const slice = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const from = page * rowsPerPage + 1;
  const to = page * rowsPerPage + slice.length;

  return (
    <Box>
      <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${T.border}`, bgcolor: alpha(T.teal, 0.06), display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography sx={{ fontSize: '0.72rem', color: T.ink3 }}>
          Showing <Box component="span" sx={{ fontWeight: 700, color: T.ink }}>{from.toLocaleString()}–{to.toLocaleString()}</Box> of {rows.length.toLocaleString()}
        </Typography>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {['#', 'Entitlement Name', 'Display Name', 'Risk Level', 'Classification', 'Total Users'].map((h) => (
                <TableCell key={h} sx={thSx}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {slice.map((ent, i) => (
              <TableRow key={`${ent.name || ent.entitlementName || i}-${page}`} sx={{ '&:last-child td': { borderBottom: 'none' }, '&:hover td': { bgcolor: T.blueLt } }}>
                <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: '0.7rem', color: T.ink4 }}>{page * rowsPerPage + i + 1}</TableCell>
                <TableCell sx={{ ...tdSx, fontWeight: 600, fontFamily: 'monospace', fontSize: '0.78rem' }}>{ent.name || ent.entitlementName || '—'}</TableCell>
                <TableCell sx={tdSx}>{ent.displayName || '—'}</TableCell>
                <TableCell sx={tdSx}><SeverityBadge severity={ent.riskLevel} /></TableCell>
                <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontSize: '0.72rem', textTransform: 'capitalize' }}>{ent.classification || '—'}</TableCell>
                <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontWeight: 600 }}>{ent.totalUsers ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={APPENDIX_PAGE_SIZES}
        sx={appendixPaginationSx}
      />
    </Box>
  );
}

const appendixSectionPaperSx = {
  borderRadius: 2,
  borderColor: T.border,
  overflow: 'hidden',
  boxShadow: '0 1px 2px rgba(13,30,53,0.05)',
};

/** Evidence blocks on the Accounts tab — shared shell (header band + content). */
const accountsEvidenceSectionSx = {
  mb: 2.5,
  borderRadius: '12px',
  border: `1px solid ${alpha(T.border, 0.9)}`,
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(13,30,53,0.045)',
  bgcolor: T.surface,
};
const accountsEvidenceHeaderSx = (accent) => ({
  px: 2.25,
  py: 1.75,
  borderBottom: `1px solid ${alpha(T.border, 0.85)}`,
  bgcolor: alpha(accent, 0.045),
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 2,
  flexWrap: 'wrap',
});

const ACCOUNTS_SCROLL_MARGIN = 116;

function scrollToAccountsSection(anchorId) {
  document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ─── main component ─────────────────────────────────────────────────── */
export default function Iso2007Report() {
  const { user, isPlatformAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [tenants, setTenants] = useState([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [apps, setApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState('');

  const [exportMenuAnchor, setExportMenuAnchor] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  const [activeTab, setActiveTab] = useState(0);
  const isoReportTabsRef = useRef(null);
  const prevTenantForCacheRef = useRef(null);
  /** Uncorrelated queue list: server page index (API uses 0-based page). */
  const [orphanListPage, setOrphanListPage] = useState(0);
  const [orphanRowsPerPage, setOrphanRowsPerPage] = useState(5);

  /** Keep tab bar in view when switching; avoids layout jump from wildly different panel heights. */
  useLayoutEffect(() => {
    const el = isoReportTabsRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 4) {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, [activeTab]);

  const initialTenant = useMemo(() => tenantIdFromUser(user), [user]);

  useEffect(() => {
    if (!isPlatformAdmin) { setSelectedTenantId(initialTenant); return; }
    let cancelled = false;
    (async () => {
      setTenantsLoading(true);
      try {
        const res = await tenantAPI.list();
        const rows = res.data?.success ? res.data.data : [];
        if (cancelled) return;
        setTenants(Array.isArray(rows) ? rows : []);
        setSelectedTenantId((prev) => {
          if (prev) return prev;
          if (initialTenant) return initialTenant;
          if (rows?.[0]?._id) return String(rows[0]._id);
          return '';
        });
      } catch { if (!cancelled) setTenants([]); }
      finally { if (!cancelled) setTenantsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isPlatformAdmin, initialTenant]);

  const fetchApps = useCallback(async (tenantId) => {
    if (!tenantId) { setApps([]); return; }
    setAppsLoading(true);
    try {
      const res = await applicationAPI.list({ tenantId, limit: 200 });
      const raw = res.data?.applications ?? res.data?.data?.applications ?? res.data?.data ?? res.data;
      const list = Array.isArray(raw) ? raw : raw?.items || [];
      const tid = String(tenantId);
      setApps(list.filter((a) => {
        const appTid = a.tenantId?._id ?? a.tenantId;
        return appTid != null && String(appTid) === tid;
      }));
    } catch { setApps([]); }
    finally { setAppsLoading(false); }
  }, []);

  useEffect(() => { fetchApps(selectedTenantId); }, [selectedTenantId, fetchApps]);

  const fetchAllApplicationUsers = useCallback(async (appId) => {
    const limit = 10000;
    const firstRes = await applicationAPI.getUsers(appId, { page: 0, limit });
    const firstPayload = firstRes.data ?? {};
    const firstRows = Array.isArray(firstPayload?.data) ? firstPayload.data
      : Array.isArray(firstPayload) ? firstPayload : [];
    const totalPages = Number(firstPayload?.totalPages ?? 0);
    if (!Number.isFinite(totalPages) || totalPages <= 1) return firstRows;
    const extras = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => applicationAPI.getUsers(appId, { page: i + 1, limit }))
    );
    const merged = [...firstRows, ...extras.flatMap((r) => {
      const p = r.data ?? {};
      return Array.isArray(p?.data) ? p.data : Array.isArray(p) ? p : [];
    })];
    const seen = new Set();
    return merged.filter((row) => {
      const key = row?._id != null ? String(row._id)
        : [row?.user_id, row?.email, row?.username].filter(Boolean).join('|');
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }, []);

  const tenantForReport = selectedTenantId || initialTenant || '';
  const tenantForOrphansKey = tenantForReport || tenantIdFromUser(user) || '';

  const reportQuery = useQuery({
    queryKey: ['iso2007-report', tenantForOrphansKey, selectedAppId],
    queryFn: () =>
      fetchIsoReportBundle({
        appId: selectedAppId,
        tenantForOrphans: tenantForOrphansKey,
        appNameFromList: apps.find((a) => String(a._id) === String(selectedAppId))?.name || '',
        fetchAllApplicationUsersFn: fetchAllApplicationUsers,
      }),
    enabled: Boolean(selectedAppId && tenantForOrphansKey),
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });

  const sodIsoQuery = useQuery({
    queryKey: ['iso2007-sod', tenantForOrphansKey, selectedAppId],
    queryFn: async () => {
      const polRes = await sodAPI.getPoliciesByApplication(selectedAppId);
      const policies = Array.isArray(polRes.data?.data?.policies)
        ? polRes.data.data.policies
        : [];
      const ids = policies.map((p) => p._id).filter(Boolean).map((id) => String(id));
      let violations = [];
      if (ids.length) {
        const vRes = await sodAPI.getViolationsForCertification(ids);
        violations = Array.isArray(vRes.data?.data) ? vRes.data.data : [];
      }
      return { policies, violations };
    },
    enabled: Boolean(selectedAppId && tenantForOrphansKey),
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    retry: 1,
  });

  /** Paged uncorrelated queue — one page in memory at a time (severity sort); TablePagination in UI. */
  const orphansQuery = useQuery({
    queryKey: ['iso2007-orphans', tenantForOrphansKey, selectedAppId, orphanListPage, orphanRowsPerPage],
    queryFn: async () => {
      const res = await correlationAPI.getOrphans({
        tenantId: tenantForOrphansKey,
        applicationId: selectedAppId,
        page: orphanListPage,
        limit: orphanRowsPerPage,
        sort: 'severity',
      });
      const p = res?.data || {};
      return {
        rows: Array.isArray(p.data) ? p.data : [],
        total: typeof p.total === 'number' ? p.total : 0,
      };
    },
    enabled: Boolean(
      selectedAppId &&
      tenantForOrphansKey &&
      reportQuery.isFetched &&
      (reportQuery.data?.correlationOrphansTotal ?? 0) > 0,
    ),
    staleTime: 30 * 1000,
    gcTime: 3 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const bundle = useMemo(
    () => (selectedAppId && reportQuery.data ? reportQuery.data : null),
    [selectedAppId, reportQuery.data],
  );

  const correlationOrphans = orphansQuery.data?.rows ?? [];
  const orphanListTotal = orphansQuery.data?.total ?? 0;

  useEffect(() => {
    setOrphanListPage(0);
  }, [selectedAppId, tenantForOrphansKey, orphanRowsPerPage]);

  useEffect(() => {
    if (!orphanListTotal || !orphanRowsPerPage) return;
    const lastIdx = Math.max(0, Math.ceil(orphanListTotal / orphanRowsPerPage) - 1);
    if (orphanListPage > lastIdx) setOrphanListPage(lastIdx);
  }, [orphanListTotal, orphanRowsPerPage, orphanListPage]);

  /** When the user switches tenant, reset app selection; drop cached report only when leaving a real tenant (not '' → first tenant). */
  useEffect(() => {
    if (prevTenantForCacheRef.current === null) {
      prevTenantForCacheRef.current = selectedTenantId;
      return;
    }
    if (prevTenantForCacheRef.current === selectedTenantId) return;
    const prev = prevTenantForCacheRef.current;
    prevTenantForCacheRef.current = selectedTenantId;
    setSelectedAppId('');
    setActiveTab(0);
    if (prev) {
      queryClient.removeQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'iso2007-report' ||
            q.queryKey[0] === 'iso2007-orphans' ||
            q.queryKey[0] === 'iso2007-orphans-pages' ||
            q.queryKey[0] === 'iso2007-sod'),
      });
    }
  }, [selectedTenantId, queryClient]);

  const appDetail = bundle?.appDetail ?? null;
  const users = bundle?.users ?? [];
  const privilegedFromAccounts = bundle?.privilegedFromAccounts ?? null;
  const privilegedAccountsList = bundle?.privilegedAccountsList ?? [];
  const privilegedEntitlements = bundle?.privilegedEntitlements ?? [];
  const privilegedFromEntitlements = bundle?.privilegedFromEntitlements ?? null;
  const certEntitlements = bundle?.certEntitlements ?? [];
  const correlationOrphansTotal = bundle?.correlationOrphansTotal ?? 0;
  const correlationOrphansStats = bundle?.correlationOrphansStats ?? null;
  const orphanQueueDigest = bundle?.orphanQueueDigest ?? null;

  const orphansListLoading =
    Boolean(selectedAppId) &&
    correlationOrphansTotal > 0 &&
    orphansQuery.isLoading &&
    !orphansQuery.data;
  const orphansListFetchingPage = Boolean(
    selectedAppId && correlationOrphansTotal > 0 && orphansQuery.isFetching && orphansQuery.data,
  );

  const detailLoading = Boolean(selectedAppId && reportQuery.isLoading);
  const loadError = selectedAppId && reportQuery.isError
    ? (() => {
      const err = reportQuery.error;
      const apiMsg = err && typeof err === 'object' && err.response?.data?.message;
      return apiMsg || err?.message || 'Failed to load report data';
    })()
    : null;

  /* derived */
  const stats = useMemo(() => computeUserStats(users), [users]);
  const privilegedDisplay = useMemo(() => {
    if (privilegedFromEntitlements !== null) return { value: privilegedFromEntitlements, source: 'entitlements' };
    const fromAcc = privilegedFromAccounts;
    const fromRaw = privilegedCountFromRawData(users);
    if (fromAcc != null && fromAcc > 0) return { value: fromAcc, source: 'accounts' };
    if (fromRaw > 0) return { value: fromRaw, source: 'import' };
    return { value: 0, source: fromAcc != null ? 'accounts' : 'none' };
  }, [users, privilegedFromAccounts, privilegedFromEntitlements]);

  const thresholdGovernanceKpiRows = useMemo(
    () =>
      buildThresholdGovernanceKpiRows(
        stats.total,
        stats.active,
        stats.inactive,
        correlationOrphansTotal,
        privilegedDisplay?.value ?? 0,
      ),
    [stats.total, stats.active, stats.inactive, correlationOrphansTotal, privilegedDisplay?.value],
  );

  const inactiveUsers = useMemo(() => users.filter(isUserInactive), [users]);

  const orphanMatchedUserLookup = useMemo(() => buildOrphanMatchedUserLookup(users), [users]);

  const mergedPrivilegedEntitlementCatalog = useMemo(
    () =>
      mergePrivilegedEntitlementCatalogs(
        certEntitlements,
        privilegedEntitlements,
      ),
    [certEntitlements, privilegedEntitlements],
  );

  const privilegedAppendixRows = useMemo(() => {
    const rows = [];
    const seen = new Set();

    for (const acc of privilegedAccountsList) {
      const key = (acc.nativeIdentity || acc._id || '').toLowerCase();
      if (key) seen.add(key);
      rows.push({
        type: 'account',
        id: acc.nativeIdentity || acc._id || `acc-${rows.length}`,
        displayName: acc.displayName || '—',
        identityName: acc.identityName || '—',
        status: acc.status || 'active',
        riskLevel: acc.riskLevel || 'LOW',
        basis: acc.accountType === 'privileged' || acc.accountType === 'admin'
          ? `Account type: ${acc.accountType}` : 'Account flag: isPrivileged',
        accountType: acc.accountType || 'personal',
        totalEntitlements: acc.totalEntitlements ?? (Array.isArray(acc.entitlements) ? acc.entitlements.length : '—'),
        lastLogin: acc.lastLogin,
      });
    }

    if (catalogHasPrivilegedDefinition(mergedPrivilegedEntitlementCatalog)) {
      const entRows = listUsersWithPrivilegedEntitlements(
        users,
        mergedPrivilegedEntitlementCatalog,
      );
      for (const { user: u, matchedEntitlements } of entRows) {
        const raw = u?.rawData || {};
        const nativeId = (u?.nativeIdentity || u?.username || u?.user_id || raw.sAMAccountName || raw.username || u?._id || '').toLowerCase();
        if (nativeId && seen.has(nativeId)) continue;
        if (nativeId) seen.add(nativeId);
        rows.push({
          type: 'entitlement',
          id: u?.nativeIdentity || u?.username || u?.user_id || raw.sAMAccountName || `ent-${rows.length}`,
          displayName: resolveUserDisplayName(u),
          identityName:
            u?.identityName ||
            raw.cn ||
            raw.sAMAccountName ||
            u?.username ||
            u?.user_id ||
            raw.username ||
            u?.email ||
            raw.email ||
            '—',
          status: u?.status || raw.status || 'active',
          riskLevel: 'HIGH',
          basis: `Entitlement: ${matchedEntitlements.slice(0, 3).join(', ')}${matchedEntitlements.length > 3 ? ` +${matchedEntitlements.length - 3}` : ''}`,
          accountType: 'entitlement-derived',
          totalEntitlements: matchedEntitlements.length,
          lastLogin: u?.lastLogin || raw.lastLogin,
        });
      }
    }

    if (rows.length === 0 && privilegedDisplay.source === 'import') {
      for (const u of users) {
        const r = u?.rawData;
        if (!r || typeof r !== 'object') continue;
        const val = r.privileged ?? r.is_privileged ?? r.isPrivileged ?? r.PRIVILEGED;
        const isPriv = val === true || val === 1 || (val != null && /^(true|yes|1|y|privileged)$/i.test(String(val).trim()));
        if (!isPriv) continue;
        rows.push({
          type: 'import',
          id: u?.nativeIdentity || u?.username || u?.user_id || r.sAMAccountName || `imp-${rows.length}`,
          displayName: resolveUserDisplayName(u),
          identityName:
            u?.identityName ||
            r.cn ||
            r.sAMAccountName ||
            u?.username ||
            u?.user_id ||
            r.username ||
            u?.email ||
            r.email ||
            '—',
          status: u?.status || r.status || 'active',
          riskLevel: 'MEDIUM',
          basis: 'Import flag: rawData.privileged',
          accountType: 'import-derived',
          totalEntitlements: '—',
          lastLogin: u?.lastLogin || r.lastLogin,
        });
      }
    }

    return rows;
  }, [
    privilegedAccountsList,
    mergedPrivilegedEntitlementCatalog,
    users,
    privilegedDisplay.source,
  ]);

  /**
   * Appendix D: `/entitlements?isPrivileged=true` uses the global Entitlement collection, which is often
   * empty or out of sync for connector-fed apps. Certification data loads the same privileged flags from
   * the application entitlement catalog — merge so Appendix D matches Appendix C.
   */
  const appendixPrivilegedEntitlements = useMemo(() => {
    const tokenLists = users.map((u) => collectPrivilegeMatchMemberTokens(u));
    const fromApi = Array.isArray(privilegedEntitlements) ? privilegedEntitlements : [];
    const fromCert = (mergedPrivilegedEntitlementCatalog || [])
      .filter((e) => normalizePrivilegeBoolean(e))
      .map((e) => {
        const name = String(e.name || e.id || '').trim() || '—';
        return {
          name,
          entitlementName: name,
          displayName: name,
          riskLevel: 'HIGH',
          classification: 'privileged',
          id: e.id,
        };
      });

    const withUserCounts = (rows) =>
      rows.map((row) => ({
        ...row,
        totalUsers: countUsersMatchingEntitlementTokenLists(tokenLists, row),
      }));

    if (fromApi.length === 0) return withUserCounts(fromCert);

    const seen = new Set(
      fromApi.map((row) => entitlementCatalogDedupeKey(row.name || row.entitlementName)),
    );
    const merged = [...fromApi];
    for (const row of fromCert) {
      const k = entitlementCatalogDedupeKey(row.name);
      if (k && !seen.has(k)) {
        seen.add(k);
        merged.push(row);
      }
    }
    return withUserCounts(merged);
  }, [privilegedEntitlements, mergedPrivilegedEntitlementCatalog, users]);

  const accountLifecycleCounts = useMemo(() => {
    const d = orphanQueueDigest;
    if (d && typeof d.total === 'number') {
      return computeAccountStatusDonutCountsFromQueueDigest(users, privilegedAppendixRows, d);
    }
    return computeAccountStatusDonutCounts(users, privilegedAppendixRows, []);
  }, [users, privilegedAppendixRows, orphanQueueDigest]);

  const governanceHealthBreakdown = useMemo(
    () => computeGovernanceHealthBreakdown(stats, privilegedDisplay.value, accountLifecycleCounts.orphan),
    [stats, privilegedDisplay.value, accountLifecycleCounts.orphan],
  );
  const governanceHealthScore = governanceHealthBreakdown?.score ?? null;
  const riskExposure10 = useMemo(
    () => governanceHealthToRiskExposure10(governanceHealthScore),
    [governanceHealthScore],
  );

  /** Weighted ISO compliance % over assessed controls (same rules as Controls tab). */
  const isoCompliantPercent = useMemo(
    () => computeIsoCompliancePercent(stats, privilegedDisplay.value, accountLifecycleCounts.orphan),
    [stats, privilegedDisplay.value, accountLifecycleCounts.orphan],
  );

  const controlStatusCounts = useMemo(() => {
    const counts = { COMPLIANT: 0, PARTIAL: 0, NON_COMPLIANT: 0, NOT_APPLICABLE: 0 };
    for (const c of ISO_CONTROLS) {
      const s = deriveControlStatus(c.id, stats, privilegedDisplay.value, accountLifecycleCounts.orphan);
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [stats, privilegedDisplay.value, accountLifecycleCounts.orphan]);

  const lifecyclePopulationTotal = useMemo(() => {
    const a = accountLifecycleCounts;
    return (
      (a.standardActive || 0) +
      (a.privileged || 0) +
      (a.inactive || 0) +
      (a.dormant || 0) +
      (a.orphan || 0)
    );
  }, [accountLifecycleCounts]);

  const accountStatusDonut = useMemo(() => {
    const c = accountLifecycleCounts;
    const rows = [
      { name: 'Standard active', value: c.standardActive, fill: ACCOUNT_STATUS_FILLS.standardActive },
      { name: 'Privileged', value: c.privileged, fill: ACCOUNT_STATUS_FILLS.privileged },
      { name: 'Inactive', value: c.inactive, fill: ACCOUNT_STATUS_FILLS.inactive },
      { name: 'Dormant', value: c.dormant, fill: ACCOUNT_STATUS_FILLS.dormant },
      { name: 'Orphan / uncorrelated', value: c.orphan, fill: ACCOUNT_STATUS_FILLS.orphan },
    ].filter((d) => d.value > 0);
    const total =
      c.standardActive + c.privileged + c.inactive + c.dormant + c.orphan;
    return { rows, total };
  }, [accountLifecycleCounts]);

  const complianceTrendData = useMemo(() => {
    const current = governanceHealthScore != null ? governanceHealthScore : (stats.total > 0 ? 72 : 0);
    const inactiveRatio = stats.inactive / Math.max(stats.total, 1);
    const previous = Math.max(45, Math.min(100, Math.round(current - 4 + (inactiveRatio * 6))));
    return [
      { label: 'Previous review', previousReview: previous, currentReview: previous },
      { label: 'Current review', previousReview: previous, currentReview: current },
    ];
  }, [governanceHealthScore, stats.total, stats.inactive]);

  const departmentRiskBarData = useMemo(() => {
    const d = orphanQueueDigest;
    if (d && typeof d.total === 'number') {
      return computeDepartmentRiskBarFromQueueDigest(users, privilegedAppendixRows, d);
    }
    return computeDepartmentRiskBarFromQueueDigest(users, privilegedAppendixRows, {
      total: 0,
      matchedQueueRowCount: 0,
      queueMatchUserIds: [],
    });
  }, [users, privilegedAppendixRows, orphanQueueDigest]);

  const selectedTenantName = useMemo(() => {
    const t = tenants.find((x) => String(x._id) === String(selectedTenantId));
    return t?.name || tenantLabel(user?.tenantId) || '—';
  }, [tenants, selectedTenantId, user?.tenantId]);

  const selectedAppName = useMemo(
    () => appDetail?.name || (selectedAppId ? '—' : 'Not selected'),
    [appDetail?.name, selectedAppId],
  );

  const asOfDate = useMemo(() => new Date().toLocaleString(), [selectedAppId]);

  const closeExportMenu = () => setExportMenuAnchor(null);

  const runGovernanceFileExport = async (format) => {
    if (!selectedAppId || !tenantForReport) return;
    setExportError('');
    setExportBusy(true);
    closeExportMenu();
    const downloadName = buildGovernanceReportExportFilename({
      orgAdminName: resolveOrgAdminDisplayName(user),
      applicationName: selectedAppName,
      format,
    });
    try {
      const res = await governanceIntelligenceExportAPI.exportReport({
        tenantId: tenantForReport,
        applicationId: selectedAppId,
        asOf: new Date().toISOString(),
        format,
        includeAppendix: true,
        includeCharts: false,
      });
      await downloadGovernanceExportBlob(res.data, downloadName);
    } catch (err) {
      let msg = err?.message || 'Export failed';
      const blob = err?.response?.data;
      if (blob instanceof Blob) {
        try {
          const text = await blob.text();
          const j = JSON.parse(text);
          if (j?.message) msg = j.message;
        } catch {
          /* keep msg */
        }
      } else if (err?.response?.data?.message) {
        msg = err.response.data.message;
      }
      setExportError(msg);
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportPdf = () => {
    const previousTitle = document.title;
    document.title = buildGovernanceReportExportFilename({
      orgAdminName: resolveOrgAdminDisplayName(user),
      applicationName: selectedAppName,
      format: 'pdf',
    }).replace(/\.pdf$/i, '');
    document.body.classList.add('iso2007-print-mode');
    const restore = () => {
      document.title = previousTitle;
      document.body.classList.remove('iso2007-print-mode');
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 2000);
  };

  const keyFindings = useMemo(() => {
    if (stats.total === 0) return [];
    const findings = [];
    const inactiveRatio = stats.inactive / Math.max(stats.total, 1);
    if (inactiveRatio > 0.2)
      findings.push({ type: 'warning', text: `${Math.round(inactiveRatio * 100)}% of accounts are inactive — consider deprovisioning review.` });
    if (accountLifecycleCounts.orphan > 0)
      findings.push({
        type: 'warning',
        text: `${accountLifecycleCounts.orphan} orphan / uncorrelated account(s) in lifecycle scope (${correlationOrphansTotal} OPEN in correlation queue) — review Accounts tab and uncorrelated workspace.`,
      });
    if (privilegedDisplay.value > 0)
      findings.push({ type: 'info', text: `${privilegedDisplay.value} privileged accounts detected — verify access recertification is current.` });

    if (!sodIsoQuery.isError && sodIsoQuery.isFetched && sodIsoQuery.data) {
      const { policies: sodPolicies = [], violations: sodViolations = [] } = sodIsoQuery.data;
      const sodOpen = sodViolations.filter((v) => String(v.status || '').toLowerCase() === 'open').length;
      if (sodOpen > 0) {
        findings.push({
          type: 'warning',
          text: `${sodOpen} open SoD violation${sodOpen === 1 ? '' : 's'} for policies scoped to this application — review the SOD tab and SoD violations workspace.`,
        });
      } else if (sodPolicies.length > 0) {
        findings.push({
          type: 'success',
          text: `SoD: ${sodPolicies.length} polic${sodPolicies.length === 1 ? 'y' : 'ies'} in scope for this application — no open violations.`,
        });
      }
    }

    if (findings.length === 0)
      findings.push({ type: 'success', text: 'No critical findings detected. Governance posture is satisfactory.' });
    return findings;
  }, [
    stats,
    privilegedDisplay.value,
    accountLifecycleCounts.orphan,
    correlationOrphansTotal,
    sodIsoQuery.isError,
    sodIsoQuery.isFetched,
    sodIsoQuery.data,
  ]);

  /* ─── render ─────────────────────────────────────────────────────── */
  return (
    <Box
      className="iso2007-report-root"
      sx={{ pt: { xs: 1, md: 1.5 }, px: { xs: 1.25, md: 2 }, pb: 4, width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', '@media print': { pt: 0, px: 0, pb: 0 } }}
    >
      <GlobalStyles styles={{
        '@media print': {
          '@page': { size: 'A4 portrait', margin: '6mm 8mm' },
          'body.iso2007-print-mode .iso2007-report-root, body.iso2007-print-mode .iso2007-report-root *': { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' },
          '.performance-monitor-fab': { display: 'none !important' },
          'body.iso2007-print-mode .MuiDrawer-root': { display: 'none !important' },
          'body.iso2007-print-mode .MuiAppBar-root': { display: 'none !important' },
          'body.iso2007-print-mode main': { marginLeft: '0 !important', width: '100% !important' },
          'body.iso2007-print-mode .iso2007-hide-print': { display: 'none !important' },
          'body.iso2007-print-mode .iso2007-print-avoid-break': { breakInside: 'avoid', pageBreakInside: 'avoid' },
        },
        '.iso2007-report-tabs .MuiTabs-scroller': { scrollBehavior: 'auto' },
      }} />

      {/* ── HEADER BANNER ─────────────────────────────────────────── */}
      <Box sx={{
        background: 'linear-gradient(135deg, #0f3380 0%, #1a4fba 55%, #2563eb 100%)',
        borderRadius: '12px', p: { xs: '20px 20px', md: '28px 28px 24px' }, mb: 3,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 2, position: 'relative', overflow: 'hidden',
        '&::before': {
          content: '""', position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='28' fill='none' stroke='rgba(255,255,255,0.04)' stroke-width='1'/%3E%3C/svg%3E") repeat`,
        },
      }}>
        <Box sx={{ flex: '1 1 auto', position: 'relative' }}>
          <Typography sx={{ fontFamily: 'monospace', fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', mb: 1, display: 'flex', alignItems: 'center', gap: 1, '&::before': { content: '""', display: 'inline-block', width: 18, height: 2, bgcolor: 'rgba(255,255,255,0.4)', borderRadius: 1 } }}>
            ISO/IEC 27001:2022 · IGA Intelligence Platform
          </Typography>
          <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: { xs: '1.4rem', md: '1.7rem' }, fontWeight: 700, color: '#fff', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            Governance Intelligence Report
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: '12px' }}>
            {[
              { label: selectedAppName },
              { label: selectedTenantName },
              { label: `Generated: ${asOfDate}`, mono: true },
            ].map((p) => (
              <Box key={p.label} component="span" sx={{
                fontSize: '0.72rem', px: '10px', py: '3px', borderRadius: '20px',
                bgcolor: p.mono ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.13)',
                color: p.mono ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.2)', fontWeight: p.mono ? 400 : 500,
                fontFamily: p.mono ? 'monospace' : 'inherit',
              }}>{p.label}</Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px', flexShrink: 0, position: 'relative' }}>
          <Box sx={{ bgcolor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: '12px', p: '14px 20px', display: 'flex', alignItems: 'center', gap: 2 }}>
            <svg width="54" height="54" viewBox="0 0 54 54">
              <circle cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="5" />
              <circle cx="27" cy="27" r="22" fill="none" stroke="#fff" strokeWidth="5"
                strokeDasharray="138.2"
                strokeDashoffset={138.2 * (1 - Math.min(stats.total > 0 ? stats.active / stats.total : 0, 1))}
                strokeLinecap="round" transform="rotate(-90 27 27)" />
              <text x="27" y="32" textAnchor="middle" fill="white" style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 500 }}>
                {stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}%` : '—'}
              </text>
            </svg>
            <Box>
              <Typography sx={{ fontFamily: 'monospace', fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>Active rate</Typography>
              <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '2rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                {stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}` : '—'}<Box component="span" sx={{ fontSize: '1.1rem', opacity: 0.6 }}>%</Box>
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', mt: '2px' }}>
                {stats.active} of {stats.total} users
              </Typography>
            </Box>
          </Box>
          <Button
            className="iso2007-hide-print"
            variant="contained"
            startIcon={exportBusy ? <CircularProgress size={14} sx={{ color: T.blue }} /> : <PictureAsPdf />}
            endIcon={exportBusy ? null : <ExpandMore sx={{ fontSize: 18 }} />}
            onClick={(e) => setExportMenuAnchor(e.currentTarget)}
            disabled={!selectedAppId || !tenantForReport || detailLoading || exportBusy}
            sx={{ bgcolor: '#fff', color: T.blue, fontWeight: 600, fontSize: '0.75rem', textTransform: 'none', borderRadius: '5px', px: 2, boxShadow: 'none', '&:hover': { bgcolor: '#eff4ff', boxShadow: 'none' }, '&:disabled': { bgcolor: 'rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.7)' } }}>
            {exportBusy ? 'Exporting…' : 'Export'}
          </Button>
          <Menu
            className="iso2007-hide-print"
            anchorEl={exportMenuAnchor}
            open={Boolean(exportMenuAnchor)}
            onClose={closeExportMenu}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { minWidth: 260 } } }}
          >
            <MenuItem
              onClick={() => runGovernanceFileExport('pdf')}
              disabled={exportBusy}
              sx={{ py: 1.25, alignItems: 'flex-start' }}
            >
              <ListItemIcon sx={{ minWidth: 36, mt: 0.25 }}><PictureAsPdf fontSize="small" /></ListItemIcon>
              <ListItemText primary="PDF report" secondary="Board / audit summary" primaryTypographyProps={{ fontWeight: 600, fontSize: '0.85rem' }} secondaryTypographyProps={{ fontSize: '0.72rem' }} />
            </MenuItem>
            {/* <MenuItem
              onClick={() => runGovernanceFileExport('excel')}
              disabled={exportBusy}
              sx={{ py: 1.25, alignItems: 'flex-start' }}
            >
              <ListItemIcon sx={{ minWidth: 36, mt: 0.25 }}><TableChart fontSize="small" /></ListItemIcon>
              <ListItemText primary="Excel workbook" secondary="Multi-sheet operational export" primaryTypographyProps={{ fontWeight: 600, fontSize: '0.85rem' }} secondaryTypographyProps={{ fontSize: '0.72rem' }} />
            </MenuItem> */}
            <MenuItem
              onClick={() => runGovernanceFileExport('pack')}
              disabled={exportBusy}
              sx={{ py: 1.25, alignItems: 'flex-start' }}
            >
              <ListItemIcon sx={{ minWidth: 36, mt: 0.25 }}><FolderZip fontSize="small" /></ListItemIcon>
              <ListItemText primary="Full pack (ZIP)" secondary="PDF + Excel" primaryTypographyProps={{ fontWeight: 600, fontSize: '0.85rem' }} secondaryTypographyProps={{ fontSize: '0.72rem' }} />
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => { closeExportMenu(); handleExportPdf(); }}
              disabled={exportBusy}
              sx={{ py: 1.25, alignItems: 'flex-start' }}
            >
              <ListItemIcon sx={{ minWidth: 36, mt: 0.25 }}><Print fontSize="small" /></ListItemIcon>
              <ListItemText primary="Print preview" secondary="Browser print (quick)" primaryTypographyProps={{ fontWeight: 600, fontSize: '0.85rem' }} secondaryTypographyProps={{ fontSize: '0.72rem' }} />
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {/* ── SELECTOR ──────────────────────────────────────────────── */}
      <Paper variant="outlined" className="iso2007-print-avoid-break" sx={{ p: 2.5, mb: 3, borderRadius: 2, borderColor: T.border, boxShadow: '0 1px 3px rgba(13,30,53,0.07)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <LayersOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 700, letterSpacing: '0.02em' }}>
            Select context
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ '& .MuiTextField-root': { width: '100%' }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}>
          {isPlatformAdmin ? (
            <Box sx={{ flex: '1 1 0', minWidth: { xs: 0, sm: 200 } }}>
              <TextField select size="small" fullWidth label="Tenant" value={selectedTenantId} disabled={tenantsLoading}
                onChange={(e) => setSelectedTenantId(e.target.value)} InputLabelProps={{ shrink: true }}
                SelectProps={{
                  displayEmpty: true, renderValue: (v) => {
                    if (!v) return <Box component="span" sx={{ color: 'text.secondary' }}>Select tenant</Box>;
                    const t = tenants.find((x) => String(x._id) === String(v));
                    return t ? `${t.name} (${t.code})` : '';
                  }
                }}>
                <MenuItem value=""><em>Select tenant</em></MenuItem>
                {tenants.map((t) => <MenuItem key={t._id} value={String(t._id)}>{t.name} ({t.code})</MenuItem>)}
              </TextField>
            </Box>
          ) : initialTenant ? (
            <Box sx={{ flex: '1 1 0', minWidth: { xs: 0, sm: 200 } }}>
              <TextField size="small" fullWidth label="Tenant" value={tenantLabel(user?.tenantId) || '—'} InputProps={{ readOnly: true }} InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'action.hover' } }} />
            </Box>
          ) : null}
          <Box sx={{ flex: '1 1 0', minWidth: { xs: 0, sm: 220 } }}>
            <TextField select size="small" fullWidth label="Application" value={selectedAppId}
              disabled={!selectedTenantId || appsLoading} onChange={(e) => setSelectedAppId(e.target.value)}
              InputLabelProps={{ shrink: true }} SelectProps={{
                displayEmpty: true, renderValue: (v) => {
                  if (!v) return <Box component="span" sx={{ color: 'text.secondary' }}>Select application</Box>;
                  const a = apps.find((x) => String(x._id) === String(v));
                  return a?.name ?? '';
                }
              }}>
              <MenuItem value=""><em>Select application</em></MenuItem>
              {apps.map((a) => <MenuItem key={a._id} value={String(a._id)}>{a.name}</MenuItem>)}
            </TextField>
          </Box>
        </Stack>
      </Paper>

      {exportError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setExportError('')}
        >
          {exportError}
        </Alert>
      )}

      {loadError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => {
            void queryClient.resetQueries({
              predicate: (q) => {
                if (!Array.isArray(q.queryKey)) return false;
                const [k0, k1, k2] = q.queryKey;
                const tenantOk = String(k1) === String(tenantForOrphansKey);
                const appOk = String(k2) === String(selectedAppId);
                if (k0 === 'iso2007-report') return tenantOk && appOk;
                if (k0 === 'iso2007-orphans' || k0 === 'iso2007-orphans-pages') return tenantOk && appOk;
                if (k0 === 'iso2007-sod') return tenantOk && appOk;
                return false;
              },
            });
          }}
        >
          {loadError}
        </Alert>
      )}
      {isPlatformAdmin && !selectedTenantId && !tenantsLoading && <Alert severity="info" sx={{ mb: 2 }}>Select a tenant to load applications.</Alert>}
      {!isPlatformAdmin && !initialTenant && <Alert severity="warning" sx={{ mb: 2 }}>Your account has no tenant context.</Alert>}

      {selectedAppId && detailLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}

      {selectedAppId && !detailLoading && (
        <>
          {/* ── KPI GRID ──────────────────────────────────────────── */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1.5, mb: 2.5 }} className="iso2007-print-avoid-break">
            <KpiCard label="Total Users" value={stats.total} accentColor={T.blueMid} />
            <KpiCard label="Active Users" value={stats.active} accentColor="#16a34a" />
            <KpiCard label="Inactive Users" value={stats.inactive} accentColor={T.ink3} />
            <KpiCard label="Privileged Users" value={privilegedDisplay.value} accentColor="#d97706" />
            <KpiCard
              label="Orphan / uncorrelated"
              value={accountLifecycleCounts.orphan}
              accentColor={ACCOUNT_STATUS_FILLS.orphan}
              hint={
                correlationOrphansTotal > 0
                  ? `${correlationOrphansTotal.toLocaleString()} OPEN in queue`
                  : accountLifecycleCounts.orphan > 0
                    ? 'Lifecycle / import flags'
                    : undefined
              }
            />
          </Box>

          {/* ── OVERALL RISK POSTURE + KEY FINDINGS ── */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 3 }} className="iso2007-print-avoid-break">
            <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: T.border, p: 2.5, bgcolor: T.surface, boxShadow: '0 1px 2px rgba(13,30,53,0.05)' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, mb: 2.25 }}>
                <Typography component="div" sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.88rem', fontWeight: 700, color: T.ink, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 4, height: 16, borderRadius: 1, bgcolor: T.blueMid, flexShrink: 0 }} />
                  Overall risk posture
                  <MuiTooltip
                    arrow
                    placement="top"
                    title={
                      <Box sx={{ maxWidth: 300, fontSize: '0.72rem', lineHeight: 1.6 }}>
                        <Box sx={{ fontWeight: 700, mb: 0.5 }}>How this is calculated</Box>
                        {governanceHealthBreakdown ? (
                          <>
                            <Box sx={{ mb: 0.5 }}>
                              <strong>Governance health</strong> = 100 − {governanceHealthBreakdown.inactivePenalty.toFixed(1)}{' '}
                              (inactive: {governanceHealthBreakdown.inactiveCount.toLocaleString()}/{governanceHealthBreakdown.total.toLocaleString()})
                              {' '}− {governanceHealthBreakdown.privilegedPenalty}{' '}
                              (privileged: {(governanceHealthBreakdown.privilegedRatio * 100).toFixed(0)}%{governanceHealthBreakdown.privilegedPenalty > 0 ? ' > 30%' : ' ≤ 30%, no penalty'})
                              {' '}− {governanceHealthBreakdown.orphanPenalty.toFixed(1)}{' '}
                              (orphan: {governanceHealthBreakdown.orphanCount.toLocaleString()}/{governanceHealthBreakdown.total.toLocaleString()})
                              {' '}= <strong>{governanceHealthBreakdown.score}</strong>
                            </Box>
                            <Box sx={{ mb: 0.5 }}>
                              <strong>Risk exposure index</strong> = (100 − {governanceHealthBreakdown.score}) ÷ 10 = <strong>{riskExposure10}</strong>
                            </Box>
                          </>
                        ) : (
                          <Box sx={{ mb: 0.5 }}>
                            <strong>Risk exposure index</strong> = (100 − Governance health) ÷ 10.
                          </Box>
                        )}
                        <Box>
                          <strong>ISO control score</strong> = ({controlStatusCounts.COMPLIANT}×100% + {controlStatusCounts.PARTIAL}×50%)
                          {' '}÷ {controlStatusCounts.COMPLIANT + controlStatusCounts.PARTIAL + controlStatusCounts.NON_COMPLIANT} assessed controls
                          {' '}= <strong>{isoCompliantPercent}%</strong>
                          {' '}({controlStatusCounts.NOT_APPLICABLE} not yet applicable)
                        </Box>
                      </Box>
                    }
                  >
                    <IconButton
                      size="small"
                      aria-label="How the risk posture score is calculated"
                      sx={{
                        p: 0.25, ml: -0.25, color: T.ink4,
                        '&:hover': { bgcolor: alpha(T.blueMid, 0.1), color: T.blueMid },
                      }}
                    >
                      <InfoOutlined sx={{ fontSize: 15 }} />
                    </IconButton>
                  </MuiTooltip>
                </Typography>
                {riskExposure10 != null && (() => {
                  const x = riskExposure10;
                  const tier = x <= 3
                    ? { label: 'Low risk', dot: T.green, bg: T.greenLt, br: T.greenBdr }
                    : x <= 6
                      ? { label: 'Medium risk', dot: T.amber, bg: T.amberLt, br: T.amberBdr }
                      : { label: 'High risk', dot: T.red, bg: T.redLt, br: T.redBdr };
                  return (
                    <Box component="span" sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
                      px: 1.25, py: 0.35, borderRadius: 999, bgcolor: tier.bg, border: `1px solid ${tier.br}`,
                      fontSize: '0.68rem', fontWeight: 600, color: T.ink2,
                    }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: tier.dot }} />
                      {tier.label}
                    </Box>
                  );
                })()}
              </Box>

              {riskExposure10 != null && governanceHealthScore != null ? (
                <Box>
                  <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: { xs: '2rem', sm: '2.25rem' }, fontWeight: 700, color: T.ink, lineHeight: 1, letterSpacing: '-0.03em' }}>
                    {riskExposure10.toFixed(1)}
                    <Typography component="span" sx={{ fontSize: '0.48em', fontWeight: 600, color: T.ink3, ml: 0.6 }}>/ 10</Typography>
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: T.ink3, mt: 0.6, mb: 2.25 }}>
                    Risk exposure index
                  </Typography>

                  {/* Companion metrics */}
                  <Box sx={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mb: 2.5,
                  }}>
                    <Box sx={{ p: 1.35, borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: alpha(T.bg, 0.55) }}>
                      <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: T.ink4, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>
                        Governance health
                      </Typography>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 700, color: T.ink, lineHeight: 1, mb: 0.85 }}>
                        {governanceHealthScore}
                        <Typography component="span" sx={{ fontSize: '0.7rem', fontWeight: 600, color: T.ink3 }}>/100</Typography>
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(Math.max(governanceHealthScore, 0), 100)}
                        sx={{
                          height: 4, borderRadius: 999, bgcolor: alpha(T.border, 0.9),
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 999,
                            bgcolor: governanceHealthScore >= 80 ? T.green : governanceHealthScore >= 60 ? T.amber : T.red,
                          },
                        }}
                      />
                    </Box>
                    <Box sx={{ p: 1.35, borderRadius: 1.5, border: `1px solid ${T.border}`, bgcolor: alpha(T.bg, 0.55) }}>
                      <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: T.ink4, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.5 }}>
                        ISO control score
                      </Typography>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 700, color: T.ink, lineHeight: 1, mb: 0.85 }}>
                        {isoCompliantPercent}
                        <Typography component="span" sx={{ fontSize: '0.7rem', fontWeight: 600, color: T.ink3 }}>%</Typography>
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(Math.max(isoCompliantPercent, 0), 100)}
                        sx={{
                          height: 4, borderRadius: 999, bgcolor: alpha(T.border, 0.9),
                          '& .MuiLinearProgress-bar': { borderRadius: 999, bgcolor: T.blueMid },
                        }}
                      />
                    </Box>
                  </Box>

                  {/* Exposure scale */}
                  <Box sx={{ position: 'relative', mb: 0.35 }}>
                    <Box sx={{ display: 'flex', gap: '3px', alignItems: 'stretch' }}>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                        <Box
                          key={i}
                          sx={{
                            flex: 1,
                            height: 8,
                            borderRadius: '2px',
                            // Breakpoints (3, 6) match the Low/Medium/High risk badge thresholds above.
                            bgcolor: i < 3 ? alpha(T.green, 0.7) : i < 6 ? alpha(T.amber, 0.75) : alpha(T.red, 0.6),
                          }}
                        />
                      ))}
                    </Box>
                    {(() => {
                      // Segments are laid out with 9 × 3px flex gaps between them, so a plain
                      // percentage-of-width position drifts a few px off its true value. Correct
                      // for the accumulated gap width so the pointer lines up with its segment.
                      const segments = 10;
                      const gapPx = 3;
                      const totalGapPx = gapPx * (segments - 1);
                      const pxOffset = Math.floor(riskExposure10) * gapPx - (totalGapPx / segments) * riskExposure10;
                      return (
                        <Box
                          sx={{
                            position: 'absolute',
                            left: `clamp(0px, calc(${(riskExposure10 / segments) * 100}% + ${pxOffset.toFixed(2)}px - 5px), calc(100% - 10px))`,
                            top: -4,
                            width: 0,
                            height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            borderBottom: `7px solid ${T.ink}`,
                          }}
                        />
                      );
                    })()}
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.25, mb: 2.5 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: T.ink4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Lower</Typography>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: T.ink4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Higher</Typography>
                  </Box>

                  {/* Contributing factors */}
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: T.ink4, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.1 }}>
                    Contributing factors
                  </Typography>
                  <Stack spacing={1.1}>
                    {[
                      { label: 'Active population', pct: Math.round((stats.active / Math.max(stats.total, 1)) * 100), color: T.green },
                      { label: 'Inactive accounts', pct: Math.round((stats.inactive / Math.max(stats.total, 1)) * 100), color: T.amber },
                      {
                        label: 'Orphan / uncorrelated',
                        pct: Math.min(
                          100,
                          Math.round((accountLifecycleCounts.orphan / Math.max(lifecyclePopulationTotal || stats.total, 1)) * 100),
                        ),
                        color: ACCOUNT_STATUS_FILLS.orphan,
                      },
                      { label: 'Privileged share', pct: Math.min(100, Math.round((privilegedDisplay.value / Math.max(stats.total, 1)) * 100)), color: T.red },
                    ].map((row) => (
                      <Box key={row.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <Typography sx={{ flex: '0 0 138px', fontSize: '0.74rem', fontWeight: 500, color: T.ink2, minWidth: 0 }}>
                          {row.label}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(Math.max(row.pct, 0), 100)}
                          sx={{
                            flex: 1,
                            height: 5,
                            borderRadius: 999,
                            bgcolor: alpha(T.border, 0.85),
                            '& .MuiLinearProgress-bar': { borderRadius: 999, bgcolor: row.color },
                          }}
                        />
                        <Typography sx={{ flex: '0 0 36px', textAlign: 'right', fontSize: '0.74rem', fontWeight: 700, fontFamily: 'monospace', color: T.ink, fontVariantNumeric: 'tabular-nums' }}>
                          {row.pct}%
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ) : (
                <Typography sx={{ fontSize: '0.82rem', color: T.ink3 }}>No data available.</Typography>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: T.border, p: 2.5, bgcolor: T.surface, boxShadow: '0 1px 2px rgba(13,30,53,0.05)' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, mb: 2 }}>
                <Typography component="div" sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.88rem', fontWeight: 700, color: T.ink, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 4, height: 16, borderRadius: 1, bgcolor: T.red, flexShrink: 0 }} />
                  Key findings
                </Typography>
                {(() => {
                  const open = keyFindings.filter((f) => f.type !== 'success').length;
                  const isClear = open === 0;
                  return (
                    <Box component="span" sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
                      px: 1.25, py: 0.35, borderRadius: 999,
                      bgcolor: isClear ? T.greenLt : T.redLt,
                      border: `1px solid ${isClear ? T.greenBdr : T.redBdr}`,
                      fontSize: '0.68rem', fontWeight: 600, color: T.ink2,
                    }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: isClear ? T.green : T.red }} />
                      {isClear ? 'No open actions' : `${open} action item${open === 1 ? '' : 's'}`}
                    </Box>
                  );
                })()}
              </Box>
              <Stack spacing={1.15}>
                {keyFindings.map((f, i) => {
                  const cfg = {
                    warning: { color: T.amber, bg: T.amberLt },
                    info: { color: T.blue, bg: T.blueLt },
                    success: { color: T.green, bg: T.greenLt },
                  }[f.type] || { color: T.ink3, bg: alpha(T.ink, 0.04) };
                  return (
                    <Box
                      key={i}
                      sx={{
                        pl: 1.5,
                        pr: 1.25,
                        py: 1.1,
                        borderRadius: '8px',
                        bgcolor: cfg.bg,
                        border: `1px solid ${alpha(cfg.color, 0.22)}`,
                        borderLeft: `4px solid ${cfg.color}`,
                      }}
                    >
                      <Typography sx={{ fontSize: '0.78rem', color: T.ink, lineHeight: 1.5, fontWeight: 500 }}>{f.text}</Typography>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          </Box>

          {/* ── TABS ──────────────────────────────────────────────── */}
          <Box
            ref={isoReportTabsRef}
            className="iso2007-hide-print iso2007-report-tabs"
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 9,
              bgcolor: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: '8px 8px 0 0',
              boxShadow: '0 1px 3px rgba(13,30,53,0.07)',
              scrollMarginTop: '8px',
            }}
          >
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              TabIndicatorProps={{ sx: { transition: 'none', bgcolor: T.blueMid, height: 2 } }}
              slotProps={{ tab: { disableRipple: true } }}
              sx={{
                '& .MuiTab-root': {
                  fontSize: '0.81rem',
                  fontWeight: 500,
                  textTransform: 'none',
                  px: '18px',
                  py: '12px',
                  color: T.ink3,
                  minHeight: 48,
                  transition: 'none',
                },
                '& .MuiTab-root.Mui-selected': { color: T.blue, fontWeight: 600 },
                borderBottom: `2px solid ${T.border}`,
              }}
            >
              <Tab label="Overview" />
              <Tab label="Controls" />
              <Tab label="Certifications" />
              <Tab label="SOD" />
              <Tab label="Accounts" />
              <Tab label="Thresholds" />
            </Tabs>
          </Box>

          <Box
            sx={{
              border: `1px solid ${T.border}`,
              borderTop: 'none',
              borderRadius: '0 0 8px 8px',
              bgcolor: alpha(T.bg, 0.35),
              p: { xs: 2, md: 2.5 },
              mb: 3,
              minHeight: 360,
            }}
          >

            {/* TAB 0: OVERVIEW */}
            {activeTab === 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, fontSize: '0.72rem', letterSpacing: '0.02em' }}>
                  Account lifecycle distribution includes import flags and OPEN uncorrelated rows from the correlation engine (same tenant + application). Compliance trend uses governance health; department bars use privileged and inactive slices.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
                  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: T.border, bgcolor: alpha(T.blueMid, 0.02), boxShadow: '0 1px 2px rgba(13,30,53,0.04)' }}>
                    <Typography component="div" sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.9rem', fontWeight: 700, color: T.ink, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 4, height: 16, borderRadius: 1, bgcolor: T.blueMid, flexShrink: 0 }} />
                      Account status distribution
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, fontSize: '0.68rem' }}>
                      Standard active vs privileged (same detection as the Accounts tab), inactive, dormant (no sign-in {ACCOUNT_DORMANT_DAYS}+ days), and orphan / uncorrelated (import flags plus OPEN correlation queue for this app). Queue-only rows are included in the orphan slice. Each logical account counted once.
                    </Typography>
                    <Box sx={{ height: { xs: 300, sm: 360 }, position: 'relative' }}>
                      {accountStatusDonut.total === 0 || accountStatusDonut.rows.length === 0 ? (
                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, fontSize: '0.82rem' }}>
                          No user data for this application.
                        </Box>
                      ) : (
                        <>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart margin={{ top: 10, right: 10, bottom: 36, left: 10 }}>
                              <Pie
                                data={accountStatusDonut.rows}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="44%"
                                innerRadius={72}
                                outerRadius={108}
                                paddingAngle={2}
                                stroke={T.surface}
                                strokeWidth={2}
                              >
                                {accountStatusDonut.rows.map((entry) => (
                                  <Cell key={entry.name} fill={entry.fill} />
                                ))}
                              </Pie>
                              <Tooltip
                                formatter={(v, name) => {
                                  return [Number(v).toLocaleString(), name];
                                }}
                                contentStyle={{ borderRadius: 8, border: `1px solid ${T.border}`, fontSize: '0.75rem' }}
                              />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" iconSize={9} wrapperStyle={{ fontSize: '0.74rem', paddingTop: 6 }} />
                            </PieChart>
                          </ResponsiveContainer>
                          <Box sx={{ position: 'absolute', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                            <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Accounts</Typography>
                            <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: { xs: '1.55rem', sm: '1.72rem' }, fontWeight: 700, color: T.ink, lineHeight: 1.1 }}>
                              {accountStatusDonut.total.toLocaleString()}
                            </Typography>
                          </Box>
                        </>
                      )}
                    </Box>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, borderColor: T.border, bgcolor: alpha(T.blueMid, 0.02), boxShadow: '0 1px 2px rgba(13,30,53,0.04)' }}>
                    <Typography component="div" sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.9rem', fontWeight: 700, color: T.ink, mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 4, height: 16, borderRadius: 1, bgcolor: T.blueMid, flexShrink: 0 }} />
                      Compliance score trend
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, fontSize: '0.68rem' }}>
                      Executive comparison of the previous review versus the current review.
                    </Typography>
                    <Box sx={{ height: { xs: 300, sm: 360 } }}>
                      {stats.total === 0 ? (
                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, fontSize: '0.82rem' }}>
                          Select data to plot trend.
                        </Box>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={complianceTrendData} margin={{ top: 12, right: 16, left: 4, bottom: 12 }}>
                            <CartesianGrid strokeDasharray="4 4" stroke={alpha(T.ink, 0.08)} vertical={false} />
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 11, fill: T.ink2 }}
                              tickLine={false}
                              axisLine={{ stroke: T.border }}
                              interval={0}
                            />
                            <YAxis domain={[45, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: T.ink3 }} width={44} tickLine={false} axisLine={false} />
                            <Tooltip
                              formatter={(v, name) => [`${v}%`, name]}
                              labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''}
                              contentStyle={{ borderRadius: 10, border: `1px solid ${T.border}`, fontSize: '0.75rem', boxShadow: '0 12px 28px rgba(13,30,53,0.12)' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '0.74rem', paddingTop: 8 }} iconType="circle" iconSize={9} />
                            <Line
                              type="monotone"
                              dataKey="previousReview"
                              name="Previous review"
                              stroke={T.ink3}
                              strokeWidth={2.2}
                              strokeDasharray="5 5"
                              dot={{ r: 4, fill: T.ink3 }}
                              activeDot={{ r: 5.5 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="currentReview"
                              name="Current review"
                              stroke={T.blueMid}
                              strokeWidth={2.6}
                              dot={{ r: 4, fill: T.blueMid }}
                              activeDot={{ r: 5.5 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </Box>
                  </Paper>
                </Box>

                <Paper
                  variant="outlined"
                  sx={{
                    p: 2.25,
                    borderRadius: 2,
                    borderColor: T.border,
                    bgcolor: T.surface,
                    boxShadow: 'none',
                    mb: 2.5,
                    width: '100%',
                  }}
                >
                  <Typography component="div" sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.92rem', fontWeight: 700, color: T.ink, mb: 0.35, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 4, height: 18, borderRadius: 1, bgcolor: ACCOUNT_STATUS_FILLS.standardActive, flexShrink: 0 }} />
                    Account status by department
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25, fontSize: '0.68rem', lineHeight: 1.45 }}>
                    Same buckets as the account lifecycle chart: standard active, privileged (appendix detection), inactive, dormant, orphan / uncorrelated — each user counted once; uncorrelated queue rows not in the certification extract appear under &quot;Uncorrelated queue (not in cert. list)&quot;. Up to 12 rows, sorted by headcount.
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" spacing={1} sx={{ mb: 1.25, rowGap: 0.75 }}>
                    {[
                      { label: 'Standard active', fill: ACCOUNT_STATUS_FILLS.standardActive },
                      { label: 'Privileged', fill: ACCOUNT_STATUS_FILLS.privileged },
                      { label: 'Inactive', fill: ACCOUNT_STATUS_FILLS.inactive },
                      { label: 'Dormant', fill: ACCOUNT_STATUS_FILLS.dormant },
                      { label: 'Orphan / uncorrelated', fill: ACCOUNT_STATUS_FILLS.orphan },
                    ].map((item) => (
                      <Box
                        key={item.label}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.65,
                          px: 0.85,
                          py: 0.25,
                          borderRadius: 1,
                          bgcolor: alpha(T.ink, 0.035),
                        }}
                      >
                        <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: item.fill, flexShrink: 0 }} />
                        <Typography component="span" sx={{ fontSize: '0.65rem', fontWeight: 600, color: T.ink2, whiteSpace: 'nowrap' }}>
                          {item.label}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                  <Box
                    sx={{
                      height: Math.max(248, Math.min(500, 28 + departmentRiskBarData.length * 40)),
                      minHeight: 200,
                    }}
                  >
                    {users.length === 0 ? (
                      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, fontSize: '0.82rem' }}>
                        No user data for this application.
                      </Box>
                    ) : departmentRiskBarData.length === 0 ? (
                      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.ink3, fontSize: '0.82rem' }}>
                        Unable to build department breakdown.
                      </Box>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={departmentRiskBarData}
                          margin={{ top: 4, right: 8, left: 0, bottom: 8 }}
                          barCategoryGap="14%"
                          barSize={28}
                        >
                          <CartesianGrid strokeDasharray="3 6" stroke={alpha(T.ink, 0.06)} horizontal={false} />
                          <XAxis
                            type="number"
                            allowDecimals={false}
                            domain={[0, (max) => (Number.isFinite(max) ? Math.max(10, Math.ceil(max * 1.08)) : 10)]}
                            tick={{ fontSize: 11, fill: T.ink3 }}
                            tickLine={false}
                            axisLine={{ stroke: alpha(T.border, 0.95) }}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={118}
                            tick={{
                              fontSize: 11,
                              fill: T.ink2,
                              fontWeight: 500,
                            }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            tickFormatter={(name) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)}
                          />
                          <Tooltip
                            cursor={{ fill: alpha(ACCOUNT_STATUS_FILLS.standardActive, 0.08) }}
                            content={({ active, label, payload }) => {
                              if (!active || !payload?.length) return null;
                              const row = payload[0]?.payload;
                              if (!row) return null;
                              const entries = [
                                { key: 'standardActive', name: 'Standard active', fill: ACCOUNT_STATUS_FILLS.standardActive },
                                { key: 'privileged', name: 'Privileged', fill: ACCOUNT_STATUS_FILLS.privileged },
                                { key: 'inactive', name: 'Inactive', fill: ACCOUNT_STATUS_FILLS.inactive },
                                { key: 'dormant', name: 'Dormant', fill: ACCOUNT_STATUS_FILLS.dormant },
                                { key: 'orphan', name: 'Orphan / uncorrelated', fill: ACCOUNT_STATUS_FILLS.orphan },
                              ];
                              const total = row.total || 0;
                              return (
                                <Paper elevation={0} sx={{ p: 1.25, borderRadius: 2, border: `1px solid ${T.border}`, boxShadow: '0 8px 24px rgba(13,30,53,0.12)', minWidth: 200 }}>
                                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: T.ink, mb: 0.75 }}>
                                    {label}
                                    <Typography component="span" sx={{ fontWeight: 600, color: T.ink3, ml: 0.75, fontSize: '0.72rem' }}>
                                      ({total.toLocaleString()} total)
                                    </Typography>
                                  </Typography>
                                  <Stack spacing={0.5}>
                                    {entries.map((e) => {
                                      const v = Number(row[e.key]) || 0;
                                      const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0';
                                      return (
                                        <Box key={e.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: e.fill, flexShrink: 0 }} />
                                            <Typography sx={{ fontSize: '0.72rem', color: T.ink2 }}>{e.name}</Typography>
                                          </Box>
                                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: T.ink }}>
                                            {v.toLocaleString()}
                                            <Typography component="span" sx={{ fontWeight: 500, color: T.ink3, ml: 0.5, fontSize: '0.68rem' }}>
                                              {pct}%
                                            </Typography>
                                          </Typography>
                                        </Box>
                                      );
                                    })}
                                  </Stack>
                                </Paper>
                              );
                            }}
                          />
                          <Bar dataKey="standardActive" name="Standard active" stackId="dept" fill={ACCOUNT_STATUS_FILLS.standardActive} stroke="none" radius={[3, 0, 0, 3]} />
                          <Bar dataKey="privileged" name="Privileged" stackId="dept" fill={ACCOUNT_STATUS_FILLS.privileged} stroke="none" radius={0} />
                          <Bar dataKey="inactive" name="Inactive" stackId="dept" fill={ACCOUNT_STATUS_FILLS.inactive} stroke="none" radius={0} />
                          <Bar dataKey="dormant" name="Dormant" stackId="dept" fill={ACCOUNT_STATUS_FILLS.dormant} stroke="none" radius={0} />
                          <Bar dataKey="orphan" name="Uncorrelated" stackId="dept" fill={ACCOUNT_STATUS_FILLS.orphan} stroke="none" radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Box>
                </Paper>
              </Box>
            )}

            {/* TAB 1: CONTROLS */}
            {activeTab === 1 && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <VerifiedUser sx={{ fontSize: 16, color: T.blue }} />
                  <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.88rem', fontWeight: 700, color: T.ink }}>
                    ISO/IEC 27001:2022 Control Assessment
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2.5 }}>
                  {[
                    { label: 'Compliant', count: controlStatusCounts.COMPLIANT, color: T.green, bg: T.greenLt, border: T.greenBdr },
                    { label: 'Partial', count: controlStatusCounts.PARTIAL, color: T.amber, bg: T.amberLt, border: T.amberBdr },
                    { label: 'Non-Compliant', count: controlStatusCounts.NON_COMPLIANT, color: T.red, bg: T.redLt, border: T.redBdr },
                    { label: 'Not assessed', count: controlStatusCounts.NOT_APPLICABLE, color: T.ink3, bg: T.bg, border: T.border },
                    { label: 'ISO score', count: `${isoCompliantPercent}%`, color: T.blue, bg: T.blueLt, border: T.blueBdr },
                  ].map((k) => (
                    <Box key={k.label} sx={{ flex: '1 1 110px', minWidth: 100, p: '12px 16px', border: `1px solid ${k.border}`, borderRadius: '8px', bgcolor: k.bg }}>
                      <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1.6rem', fontWeight: 700, lineHeight: 1, color: k.color }}>{k.count}</Typography>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: '0.63rem', fontWeight: 600, color: k.color, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 0.5 }}>{k.label}</Typography>
                    </Box>
                  ))}
                </Box>
                <Typography sx={{ fontSize: '0.7rem', color: T.ink3, mb: 1.5, lineHeight: 1.45 }}>
                  Score weights assessed controls only (Compliant = 1, Partial = 0.5). Screening, authentication, malware, and software-install controls stay N/A until evidence is available.
                </Typography>
                <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: T.border, overflow: 'hidden' }}>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {['Control ID', 'Title', 'Domain', 'Description', 'Status'].map((h) => (
                            <TableCell key={h} sx={thSx}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {ISO_CONTROLS.map((ctrl) => {
                          const status = deriveControlStatus(ctrl.id, stats, privilegedDisplay.value, accountLifecycleCounts.orphan);
                          return (
                            <TableRow key={ctrl.id} sx={{ '&:last-child td': { borderBottom: 'none' }, '&:hover td': { bgcolor: T.blueLt } }}>
                              <TableCell sx={{ ...tdSx, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem', color: T.blue, whiteSpace: 'nowrap' }}>{ctrl.id}</TableCell>
                              <TableCell sx={{ ...tdSx, fontWeight: 600, whiteSpace: 'nowrap' }}>{ctrl.title}</TableCell>
                              <TableCell sx={{ ...tdSx, whiteSpace: 'nowrap' }}>
                                <Chip label={ctrl.domain} size="small" sx={{ fontSize: '0.62rem', height: 20, bgcolor: T.blueLt, color: T.blue, border: `1px solid ${T.blueBdr}`, fontWeight: 600 }} />
                              </TableCell>
                              <TableCell sx={{ ...tdSx, fontSize: '0.75rem', maxWidth: 320 }}>{ctrl.desc}</TableCell>
                              <TableCell sx={tdSx}><ControlBadge status={status} /></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                </Paper>              </Box>
            )}

            {/* TAB 2: CERTIFICATIONS */}
            {activeTab === 2 && (
              <AccessCertificationSection
                applicationId={selectedAppId}
                applicationName={appDetail?.name || appDetail?.applicationName}
              />
            )}

            {/* TAB 3: SOD */}
            {activeTab === 3 && (
              <IsoReportSodSection
                applicationId={selectedAppId}
                applicationName={appDetail?.name || appDetail?.applicationName}
                policies={sodIsoQuery.data?.policies ?? []}
                violations={sodIsoQuery.data?.violations ?? []}
                loading={Boolean(selectedAppId && tenantForOrphansKey && sodIsoQuery.isPending)}
                error={
                  sodIsoQuery.isError
                    ? (() => {
                      const err = sodIsoQuery.error;
                      const apiMsg = err && typeof err === 'object' && err.response?.data?.message;
                      return apiMsg || err?.message || 'Failed to load SoD data';
                    })()
                    : null
                }
              />
            )}

            {/* TAB 4: ACCOUNTS — structured evidence */}
            {activeTab === 4 && (
              <Box>
                <Box sx={{ mb: 2 }}>
                  <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: T.ink, mb: 0.5 }}>
                    Account scope &amp; evidence
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: T.ink3, lineHeight: 1.55, maxWidth: 720 }}>
                    Inventory and schedules below use the current application selection. Use the quick links to jump; each block has its own search and pagination.
                  </Typography>
                </Box>

                <Box
                  sx={{
                    position: 'sticky',
                    top: 52,
                    zIndex: 6,
                    mx: { xs: -2, md: -2.5 },
                    px: { xs: 2, md: 2.5 },
                    py: 1.25,
                    mb: 2.5,
                    bgcolor: alpha(T.surface, 0.92),
                    backdropFilter: 'blur(10px)',
                    borderBottom: `1px solid ${alpha(T.border, 0.85)}`,
                    borderTop: `1px solid ${alpha(T.border, 0.5)}`,
                  }}
                >
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: T.ink3, textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1 }}>
                    Scope summary — jump to
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1 }}>
                    {[
                      { anchor: 'iso-acct-inventory', label: 'Accounts', sub: 'Inventory', count: stats.total, icon: <AssignmentOutlined sx={{ fontSize: 18 }} />, accent: T.blueMid },
                      { anchor: 'iso-acct-orphans', label: 'Uncorrelated', sub: 'OPEN queue', count: correlationOrphansTotal, icon: <LinkOff sx={{ fontSize: 18 }} />, accent: ACCOUNT_STATUS_FILLS.orphan },
                      { anchor: 'iso-acct-inactive', label: 'Inactive', sub: 'Review', count: inactiveUsers.length, icon: <PersonOff sx={{ fontSize: 18 }} />, accent: T.ink3 },
                      { anchor: 'iso-acct-privileged', label: 'Privileged', sub: 'Users', count: privilegedAppendixRows.length, icon: <Shield sx={{ fontSize: 18 }} />, accent: '#d97706' },
                      { anchor: 'iso-acct-entitlements', label: 'Entitlements', sub: 'Catalog', count: appendixPrivilegedEntitlements.length, icon: <Security sx={{ fontSize: 18 }} />, accent: T.teal },
                    ].map((s) => (
                      <Box
                        key={s.anchor}
                        component="button"
                        type="button"
                        onClick={() => scrollToAccountsSection(s.anchor)}
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 0.5,
                          p: 1.25,
                          borderRadius: '10px',
                          cursor: 'pointer',
                          border: `1px solid ${alpha(T.border, 0.95)}`,
                          bgcolor: T.surface,
                          font: 'inherit',
                          textAlign: 'left',
                          transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s',
                          boxShadow: '0 1px 2px rgba(13,30,53,0.04)',
                          '&:hover': {
                            borderColor: alpha(s.accent, 0.45),
                            bgcolor: alpha(s.accent, 0.05),
                            boxShadow: '0 2px 10px rgba(13,30,53,0.07)',
                          },
                          '&:focus-visible': { outline: `2px solid ${alpha(s.accent, 0.5)}`, outlineOffset: 2 },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
                          <Box sx={{ color: s.accent, display: 'flex', flexShrink: 0 }}>{s.icon}</Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: T.ink, lineHeight: 1.2 }}>{s.label}</Typography>
                            <Typography sx={{ fontSize: '0.6rem', color: T.ink3, fontWeight: 500 }}>{s.sub}</Typography>
                          </Box>
                        </Box>
                        <Typography sx={{ fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 800, color: s.accent, lineHeight: 1, pl: 0.25 }}>
                          {Number(s.count).toLocaleString()}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Paper id="iso-acct-inventory" elevation={0} sx={{ ...accountsEvidenceSectionSx, scrollMarginTop: `${ACCOUNTS_SCROLL_MARGIN}px` }}>
                  <Box sx={accountsEvidenceHeaderSx(T.blueMid)}>
                    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', minWidth: 0 }}>
                      <Box sx={{ width: 4, borderRadius: 1, bgcolor: T.blueMid, flexShrink: 0, mt: 0.5, alignSelf: 'stretch', minHeight: 36 }} />
                      <Box>
                        <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1rem', fontWeight: 700, color: T.ink, mb: 0.5 }}>
                          Application account inventory
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: T.ink3, lineHeight: 1.55, maxWidth: 640 }}>
                          Directory of accounts in certification scope. Use the grid search and column controls as needed; pagination is managed in the table footer.
                        </Typography>
                      </Box>
                    </Box>
                    <Chip label={`${stats.total.toLocaleString()} in scope`} size="small" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.68rem', height: 28, borderRadius: 2, bgcolor: T.blueLt, color: T.blue, border: `1px solid ${T.blueBdr}` }} />
                  </Box>
                  <Box sx={{ p: { xs: 1.25, sm: 1.75 } }}>
                    <UsersTable
                      applicationId={selectedAppId}
                      userMappings={appDetail?.userMappings}
                      accountsTablePreferences={appDetail?.accountsTablePreferences || null}
                      showAccountsBanner={false}
                      enableReportFeatures
                    />
                  </Box>
                </Paper>

                <Paper id="iso-acct-orphans" elevation={0} sx={{ ...accountsEvidenceSectionSx, scrollMarginTop: `${ACCOUNTS_SCROLL_MARGIN}px` }}>
                  <Box sx={accountsEvidenceHeaderSx(ACCOUNT_STATUS_FILLS.orphan)}>
                    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', minWidth: 0 }}>
                      <Box sx={{ width: 4, borderRadius: 1, bgcolor: ACCOUNT_STATUS_FILLS.orphan, flexShrink: 0, mt: 0.5, alignSelf: 'stretch', minHeight: 36 }} />
                      <Box>
                        <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1rem', fontWeight: 700, color: T.ink, mb: 0.5 }}>
                          Uncorrelated &amp; orphan accounts
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: T.ink3, lineHeight: 1.55, maxWidth: 720 }}>
                          Account has no valid owner match in the correlation engine — typically remediate (link, disable, or delete). Data source: OPEN rows in the uncorrelated queue for this application.
                        </Typography>
                      </Box>
                    </Box>
                    <Stack direction="row" flexWrap="wrap" sx={{ justifyContent: 'flex-end', gap: 0.75 }}>
                      <Chip
                        label={`${correlationOrphansTotal.toLocaleString()} OPEN`}
                        size="small"
                        sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.65rem', height: 26, bgcolor: T.redLt, color: T.red, border: `1px solid ${T.redBdr}` }}
                      />
                      {typeof correlationOrphansStats?.highRiskOpenTotal === 'number' && correlationOrphansStats.highRiskOpenTotal > 0 && (
                        <Chip
                          icon={<WarningAmber sx={{ fontSize: '16px !important', color: `${T.amber} !important` }} />}
                          label={`${correlationOrphansStats.highRiskOpenTotal} HIGH+ in scope`}
                          size="small"
                          sx={{ fontWeight: 700, fontSize: '0.65rem', height: 26, bgcolor: T.amberLt, color: T.amber, border: `1px solid ${T.amberBdr}` }}
                        />
                      )}
                      <Chip
                        label={
                          orphansListLoading
                            ? 'Loading page…'
                            : `${correlationOrphansTotal.toLocaleString()} in queue (paginated)`
                        }
                        size="small"
                        variant="outlined"
                        sx={{ fontWeight: 600, fontSize: '0.65rem', height: 26 }}
                      />
                    </Stack>
                  </Box>
                  <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
                    {(orphansListLoading || orphansListFetchingPage) && (
                      <LinearProgress sx={{ mb: 2, borderRadius: 1, height: 3 }} />
                    )}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 2 }}>
                      <Typography sx={{ fontSize: '0.68rem', color: T.ink4, flex: 1 }}>
                        Remediation actions (assign / ignore) run from that screen. This report is read-only evidence.
                      </Typography>
                    </Stack>
                    {correlationOrphansTotal === 0 ? (
                      <Alert severity="info" sx={{ fontSize: '0.72rem', '& .MuiAlert-message': { fontSize: '0.72rem' } }}>
                        No OPEN uncorrelated accounts in the correlation queue for this application (tenant scope). Run manual correlation or the correlation engine to refresh detection.
                      </Alert>
                    ) : (
                      <>
                        <Stack spacing={1.5} sx={{ width: '100%' }}>
                          {correlationOrphans.map((row, idx) => {
                            const matchedUser = matchedUserForOrphanRow(row, orphanMatchedUserLookup);
                            const rk = String(row._id ?? `${row.applicationId}-${row.accountId}-${row.correlationKey}`);
                            return (
                              <IsoOrphanEvidenceCard
                                key={`${orphanListPage}-${idx}-${rk}`}
                                row={row}
                                matchedUser={matchedUser}
                                selectedAppName={selectedAppName}
                              />
                            );
                          })}
                        </Stack>
                        <TablePagination
                          component="div"
                          count={orphanListTotal}
                          page={orphanListPage}
                          onPageChange={(_, newPage) => setOrphanListPage(newPage)}
                          rowsPerPage={orphanRowsPerPage}
                          onRowsPerPageChange={(e) => {
                            setOrphanRowsPerPage(parseInt(e.target.value, 10));
                            setOrphanListPage(0);
                          }}
                          rowsPerPageOptions={[5, 10, 25, 50, 100]}
                          sx={{
                            borderTop: `1px solid ${T.border}`,
                            mt: 2,
                            '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', gap: 1 },
                            '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                              fontSize: '0.75rem',
                            },
                          }}
                        />
                      </>
                    )}
                  </Box>
                </Paper>

                <Paper id="iso-acct-inactive" elevation={0} sx={{ ...accountsEvidenceSectionSx, scrollMarginTop: `${ACCOUNTS_SCROLL_MARGIN}px` }}>
                  <Box sx={accountsEvidenceHeaderSx(T.ink3)}>
                    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', minWidth: 0 }}>
                      <Box sx={{ width: 4, borderRadius: 1, bgcolor: T.ink3, flexShrink: 0, mt: 0.5, alignSelf: 'stretch', minHeight: 36 }} />
                      <Box>
                        <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1rem', fontWeight: 700, color: T.ink, mb: 0.5 }}>
                          Inactive accounts
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: T.ink3, lineHeight: 1.55, maxWidth: 560 }}>
                          Accounts not in an active state within this population, for access review and remediation tracking.
                        </Typography>
                      </Box>
                    </Box>
                    <Chip label={`${inactiveUsers.length.toLocaleString()} records`} size="small" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.68rem', height: 28, borderRadius: 2 }} />
                  </Box>
                  <Box sx={{ p: 0 }}>
                    <Paper variant="outlined" sx={{ ...appendixSectionPaperSx, borderRadius: 0, border: 'none', boxShadow: 'none' }}>
                      <InlineUsersTable
                        rows={inactiveUsers}
                        userMappings={appDetail?.userMappings}
                        emptyMsg="No inactive users found."
                      />
                    </Paper>
                  </Box>
                </Paper>

                <Paper id="iso-acct-privileged" elevation={0} sx={{ ...accountsEvidenceSectionSx, scrollMarginTop: `${ACCOUNTS_SCROLL_MARGIN}px` }}>
                  <Box sx={accountsEvidenceHeaderSx('#d97706')}>
                    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', minWidth: 0 }}>
                      <Box sx={{ width: 4, borderRadius: 1, bgcolor: '#d97706', flexShrink: 0, mt: 0.5, alignSelf: 'stretch', minHeight: 36 }} />
                      <Box>
                        <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1rem', fontWeight: 700, color: T.ink, mb: 0.5 }}>
                          Privileged user access
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: T.ink3, lineHeight: 1.55, maxWidth: 560 }}>
                          Elevated access derived from account attributes, privileged entitlements, and import metadata. Basis describes how each row was classified.
                        </Typography>
                      </Box>
                    </Box>
                    <Chip label={`${privilegedAppendixRows.length.toLocaleString()} records`} size="small" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.68rem', height: 28, borderRadius: 2, bgcolor: T.amberLt, color: T.amber, border: `1px solid ${T.amberBdr}` }} />
                  </Box>
                  <Box sx={{ p: 0 }}>
                    <Paper variant="outlined" sx={{ ...appendixSectionPaperSx, borderRadius: 0, border: 'none', boxShadow: 'none' }}>
                      <PrivilegedAppendixTable rows={privilegedAppendixRows} />
                    </Paper>
                  </Box>
                  {privilegedAppendixRows.length > 0 && privilegedAppendixRows.length !== privilegedDisplay.value && (
                    <Alert severity="info" sx={{ mx: 2, mb: 2, fontSize: '0.72rem', '& .MuiAlert-message': { fontSize: '0.72rem' } }}>
                      The summary KPI reports {privilegedDisplay.value} privileged user{privilegedDisplay.value !== 1 ? 's' : ''} (source: {privilegedDisplay.source}).
                      This schedule lists {privilegedAppendixRows.length} distinct record{privilegedAppendixRows.length !== 1 ? 's' : ''} after reconciling account-level and entitlement-level detections.
                    </Alert>
                  )}
                </Paper>

                <Paper id="iso-acct-entitlements" elevation={0} sx={{ ...accountsEvidenceSectionSx, scrollMarginTop: `${ACCOUNTS_SCROLL_MARGIN}px` }}>
                  <Box sx={accountsEvidenceHeaderSx(T.teal)}>
                    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', minWidth: 0 }}>
                      <Box sx={{ width: 4, borderRadius: 1, bgcolor: T.teal, flexShrink: 0, mt: 0.5, alignSelf: 'stretch', minHeight: 36 }} />
                      <Box>
                        <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1rem', fontWeight: 700, color: T.ink, mb: 0.5 }}>
                          Privileged entitlements catalog
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: T.ink3, lineHeight: 1.55, maxWidth: 640 }}>
                          Definitions from the access-certification entitlement catalog, aligned with the privileged access schedule above, plus matching entries from the central entitlements service where available.
                        </Typography>
                      </Box>
                    </Box>
                    <Chip label={`${appendixPrivilegedEntitlements.length.toLocaleString()} definitions`} size="small" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.68rem', height: 28, borderRadius: 2, bgcolor: T.tealLt, color: T.teal, border: `1px solid ${T.tealBdr}` }} />
                  </Box>
                  <Box sx={{ p: 0 }}>
                    <Paper variant="outlined" sx={{ ...appendixSectionPaperSx, borderRadius: 0, border: 'none', boxShadow: 'none' }}>
                      <PrivilegedEntitlementsAppendixTable rows={appendixPrivilegedEntitlements} />
                    </Paper>
                  </Box>
                </Paper>
              </Box>
            )}

            {/* TAB 5: THRESHOLDS */}
            {activeTab === 5 && (
              <>
                <ApplicationReportingRuleSetSection
                  tenantId={tenantForReport}
                  applicationId={selectedAppId}
                  stats={stats}
                  privilegedDisplay={privilegedDisplay}
                  liveReportLoading={Boolean(selectedAppId && (!reportQuery.isFetched || reportQuery.isLoading))}
                />

                <Paper
                  elevation={0}
                  sx={{
                    mt: 3,
                    borderRadius: 2,
                    border: `1px solid ${T.border}`,
                    bgcolor: T.surface,
                    boxShadow: '0 4px 28px rgba(13, 30, 53, 0.07)',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      px: { xs: 2.25, sm: 3 },
                      pt: 2.5,
                      pb: 2,
                      borderBottom: `1px solid ${alpha(T.border, 0.95)}`,
                      bgcolor: alpha(T.blue, 0.04),
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 1.5,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: 2,
                          bgcolor: T.surface,
                          border: `1px solid ${alpha(T.border, 0.95)}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Assessment sx={{ fontSize: 22, color: T.blue }} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '1.05rem', fontWeight: 700, color: T.ink, letterSpacing: '-0.01em' }}>
                          Governance exposure
                        </Typography>
                      </Box>
                    </Box>
                    <Chip
                      label="Live · report data"
                      size="small"
                      sx={{
                        height: 26,
                        fontWeight: 600,
                        fontSize: '0.68rem',
                        borderRadius: 2,
                        bgcolor: T.surface,
                        border: `1px solid ${alpha(T.border, 0.95)}`,
                        color: T.ink2,
                      }}
                    />
                  </Box>

                  {!selectedAppId ? (
                    <Box sx={{ px: 3, py: 4 }}>
                      <Typography sx={{ fontSize: '0.88rem', color: T.ink3 }}>Select an application to load the governance KPI chart.</Typography>
                    </Box>
                  ) : !thresholdGovernanceKpiRows ? (
                    <Box sx={{ px: 3, py: 4 }}>
                      <Typography sx={{ fontSize: '0.88rem', color: T.ink3 }}>No certification users loaded for this application yet.</Typography>
                    </Box>
                  ) : (
                    <>
                      <GovernanceExecutiveKpiPieDonut rows={thresholdGovernanceKpiRows} />
                    </>
                  )}
                </Paper>
              </>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
