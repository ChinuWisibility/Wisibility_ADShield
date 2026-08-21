import { STATUS_BADGE_COLORS } from '../governance/accessCertification/AcessStyles';

export const WIDGET_TITLES = {
  orphanedProfiles: 'Orphaned Accounts',
  missingManagers: 'Missing managers (by identity source)',
  missingManagersByApplication: 'Missing managers (by linked application)',
  managerMismatches: 'Manager mismatches',
  statusMismatches: 'Status mismatches',
  unassignedEntitlements: 'Unassigned entitlements',
  privilegedEntitlements: 'Privileged entitlements',
  entitlementsMissingOwner: 'Entitlements missing owner',
  inactiveUsersWithAccess: 'Inactive users with access',
  accessCertificationCampaigns: 'Access certification',
  sodPoliciesViolations: 'SoD policies & violations',
  duplicateAccountsByApplication: 'Duplicate accounts',
};

export const VALID_WIDGETS = new Set(Object.keys(WIDGET_TITLES));

const ENTITLEMENT_WIDGET_IDS = new Set([
  'unassignedEntitlements',
  'privilegedEntitlements',
  'entitlementsMissingOwner',
]);

export function hasPresentValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return !Number.isNaN(v);
  if (typeof v === 'boolean') return true;
  return String(v).trim().length > 0;
}

export function resolveTenantId(user) {
  if (!user?.tenantId) return null;
  return typeof user.tenantId === 'object' ? user.tenantId?._id : user.tenantId;
}

export function buildBackTo(path, tenantId, dashboardView) {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (dashboardView === 'application') params.set('view', 'application');
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Metrics shown on Metrics view but not on Applications tiles. */
const APPLICATION_TILE_EXCLUDED_WIDGET_IDS = new Set(['missingManagers']);

export function sanitizeApplicationTile(tile) {
  if (!tile) return tile;
  const rows = Array.isArray(tile.rows)
    ? tile.rows.filter((row) => !APPLICATION_TILE_EXCLUDED_WIDGET_IDS.has(row.detailWidgetId))
    : [];
  if (rows.length === tile.rows?.length) return tile;
  const totalCount = rows.reduce((sum, row) => sum + (row.count || 0), 0);
  return { ...tile, rows, totalCount };
}

/** @param {object | null} summary — cached hygiene summary */
export function findApplicationTile(summary, applicationId) {
  const tiles = summary?.applicationTiles;
  if (!Array.isArray(tiles) || applicationId == null || applicationId === '') return null;
  const id = String(applicationId);
  const tile = tiles.find((t) => t.applicationId != null && String(t.applicationId) === id) ?? null;
  return sanitizeApplicationTile(tile);
}

export function parseRecord(row, widgetId) {
  if (widgetId === 'orphanedProfiles' && (row.kind === 'orphan' || !row.kind)) return { kind: 'orphan', o: row };
  if (widgetId === 'missingManagers' && row.kind === 'identity') return { kind: 'mm', i: row };
  if (widgetId === 'missingManagersByApplication' && row.kind === 'identity') return { kind: 'mma', i: row };
  if (widgetId === 'managerMismatches' && row.kind === 'managerMismatch') return { kind: 'mgrx', m: row };
  if (widgetId === 'statusMismatches' && row.kind === 'statusMismatch') return { kind: 'stmx', s: row };
  if (ENTITLEMENT_WIDGET_IDS.has(widgetId) && row.kind === 'entitlement') return { kind: 'ent', e: row };
  if (widgetId === 'inactiveUsersWithAccess' && row.kind === 'inactiveAccess') return { kind: 'ina', a: row };
  if (widgetId === 'accessCertificationCampaigns' && row.kind === 'campaign') return { kind: 'camp', c: row };
  if (widgetId === 'sodPoliciesViolations' && row.kind === 'sodPolicy') return { kind: 'sodPol', p: row };
  if (widgetId === 'duplicateAccountsByApplication' && row.kind === 'duplicateAccount') {
    return { kind: 'dup', d: row };
  }
  return null;
}

export function lifecycleChipColors(value) {
  const v = String(value).toUpperCase();
  if (['TERMINATED', 'LEAVER', 'INACTIVE'].includes(v))
    return { bgcolor: '#fee2e2', color: '#b91c1c', border: '#fca5a5' };
  if (['QUARANTINE'].includes(v))
    return { bgcolor: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
  if (['ACTIVE'].includes(v))
    return { bgcolor: '#dcfce7', color: '#15803d', border: '#86efac' };
  return { bgcolor: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
}

export function riskChipColors(value) {
  const v = String(value).toUpperCase();
  if (['HIGH', 'CRITICAL'].includes(v))
    return { bgcolor: '#fee2e2', color: '#b91c1c', border: '#fca5a5' };
  if (['MEDIUM'].includes(v))
    return { bgcolor: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
  if (['LOW'].includes(v))
    return { bgcolor: '#fefce8', color: '#854d0e', border: '#fde68a' };
  return { bgcolor: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
}

function normalizeManagerHygieneIssue(issue) {
  if (issue === 'top_of_hierarchy' || issue === 'root') return 'top_of_hierarchy';
  if (issue === 'unresolved') return 'unresolved';
  if (issue === 'missing_manager' || issue === 'resolved') return 'missing_manager';
  return issue || 'missing_manager';
}

export function managerHygieneIssueLabel(issue, row) {
  const kind = normalizeManagerHygieneIssue(issue);
  if (kind === 'top_of_hierarchy') return 'Top of hierarchy';
  if (kind === 'unresolved') {
    const raw = row?.managerKeyRaw;
    if (raw != null && String(raw).trim()) return `Unresolved: ${String(raw).trim()}`;
    return 'Unresolved manager';
  }
  return 'No manager assigned';
}

export function managerHygieneIssueChipColors(issue) {
  const kind = normalizeManagerHygieneIssue(issue);
  if (kind === 'top_of_hierarchy') {
    return { bgcolor: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' };
  }
  if (kind === 'unresolved') {
    return { bgcolor: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
  }
  return { bgcolor: '#fee2e2', color: '#b91c1c', border: '#fca5a5' };
}

export function certificationStatusChipColors(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/\s+/g, '');
  const statusKey = Object.keys(STATUS_BADGE_COLORS).find((k) => {
    const kn = k.toLowerCase();
    return normalized === kn || normalized.includes(kn);
  });
  if (statusKey) {
    const s = STATUS_BADGE_COLORS[statusKey];
    return { bgcolor: s.bg, color: s.text, border: s.border };
  }
  if (normalized.includes('decision') && normalized.includes('pending')) {
    const s = STATUS_BADGE_COLORS.Pending;
    return { bgcolor: s.bg, color: s.text, border: s.border };
  }
  return { bgcolor: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
}

const COUNT_COLUMN_TEXT_COLORS = {
  totalItems: '#2563eb',
  approvedItems: '#16a34a',
  revokedItems: '#dc2626',
  pendingItems: '#ea580c',
  totalViolations: '#2563eb',
  openViolations: '#dc2626',
  remediated: '#16a34a',
  exceptionGranted: '#7c3aed',
};

export function countColumnTextColor(countKey) {
  return COUNT_COLUMN_TEXT_COLORS[countKey] || '#334155';
}
