/**
 * Per-user identity catalog tab ids and URL query mapping.
 * Query: ?tab=overview|accounts|mindmap|posture|peers|sod|certifications|hygiene|privileges
 */

export const CATALOG_TAB_IDS = {
  OVERVIEW: 'overview',
  ACCOUNTS: 'accounts',
  MINDMAP: 'mindmap',
  POSTURE: 'posture',
  PEERS: 'peers',
  SOD: 'sod',
  CERTIFICATIONS: 'certifications',
  HYGIENE: 'hygiene',
  PRIVILEGES: 'privileges',
};

export const CATALOG_TAB_ORDER = [
  CATALOG_TAB_IDS.OVERVIEW,
  CATALOG_TAB_IDS.ACCOUNTS,
  CATALOG_TAB_IDS.MINDMAP,
  CATALOG_TAB_IDS.POSTURE,
  CATALOG_TAB_IDS.PEERS,
  CATALOG_TAB_IDS.SOD,
  CATALOG_TAB_IDS.CERTIFICATIONS,
  CATALOG_TAB_IDS.HYGIENE,
  CATALOG_TAB_IDS.PRIVILEGES,
];

/** Resolve ?tab= value to catalog tab index (0-based). */
export function catalogTabIndexFromQuery(tabParam) {
  const raw = String(tabParam || '').trim().toLowerCase();
  if (!raw || raw === 'overview' || raw === 'hr') return 0;
  if (raw === 'certification') return CATALOG_TAB_ORDER.indexOf(CATALOG_TAB_IDS.CERTIFICATIONS);
  if (raw === 'datahygiene' || raw === 'data-hygiene') {
    return CATALOG_TAB_ORDER.indexOf(CATALOG_TAB_IDS.HYGIENE);
  }
  if (raw === 'privilege' || raw === 'privileged') {
    return CATALOG_TAB_ORDER.indexOf(CATALOG_TAB_IDS.PRIVILEGES);
  }
  const idx = CATALOG_TAB_ORDER.indexOf(raw);
  return idx >= 0 ? idx : 0;
}

export function catalogTabIdFromIndex(index) {
  return CATALOG_TAB_ORDER[index] || CATALOG_TAB_IDS.OVERVIEW;
}

/** Build path into the identity catalog for a given tab. */
export function identityCatalogPath(identityId, tabId = CATALOG_TAB_IDS.OVERVIEW) {
  const id = String(identityId || '').trim();
  if (!id) return '/identities';
  const tab = tabId && tabId !== CATALOG_TAB_IDS.OVERVIEW ? `?tab=${tabId}` : '';
  return `/identities/${id}${tab}`;
}
