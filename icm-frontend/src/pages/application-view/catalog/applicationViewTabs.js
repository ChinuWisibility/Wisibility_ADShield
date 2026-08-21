/**
 * Application View catalog tab ids and URL query mapping.
 * Query: ?tab=overview|users|entitlements|accessgraph|sod|correlation|hygiene|…
 */

export const APP_VIEW_TAB_IDS = {
  OVERVIEW: 'overview',
  USERS: 'users',
  ENTITLEMENTS: 'entitlements',
  ACCESS_GRAPH: 'accessgraph',
  SOD: 'sod',
  CORRELATION: 'correlation',
  HYGIENE: 'hygiene',
  CERTIFICATIONS: 'certifications',
  RISK_COMPLIANCE: 'risk-compliance',
  ACTIVITY: 'activity',
};

export const APP_VIEW_TAB_ORDER = [
  APP_VIEW_TAB_IDS.OVERVIEW,
  APP_VIEW_TAB_IDS.USERS,
  APP_VIEW_TAB_IDS.ENTITLEMENTS,
  APP_VIEW_TAB_IDS.ACCESS_GRAPH,
  APP_VIEW_TAB_IDS.SOD,
  APP_VIEW_TAB_IDS.CORRELATION,
  APP_VIEW_TAB_IDS.HYGIENE,
  APP_VIEW_TAB_IDS.CERTIFICATIONS,
  APP_VIEW_TAB_IDS.RISK_COMPLIANCE,
  APP_VIEW_TAB_IDS.ACTIVITY,
];

/** Resolve ?tab= value to catalog tab index (0-based). */
export function appViewTabIndexFromQuery(tabParam) {
  const raw = String(tabParam || '').trim().toLowerCase();
  if (!raw || raw === 'overview') return 0;
  if (raw === 'accounts') return APP_VIEW_TAB_ORDER.indexOf(APP_VIEW_TAB_IDS.USERS);
  if (raw === 'access-graph' || raw === 'mindmap' || raw === 'graph') {
    return APP_VIEW_TAB_ORDER.indexOf(APP_VIEW_TAB_IDS.ACCESS_GRAPH);
  }
  if (raw === 'datahygiene' || raw === 'data-hygiene' || raw === 'dataquality' || raw === 'data-quality') {
    return APP_VIEW_TAB_ORDER.indexOf(APP_VIEW_TAB_IDS.HYGIENE);
  }
  const idx = APP_VIEW_TAB_ORDER.indexOf(raw);
  return idx >= 0 ? idx : 0;
}

export function appViewTabIdFromIndex(index) {
  return APP_VIEW_TAB_ORDER[index] || APP_VIEW_TAB_IDS.OVERVIEW;
}

/** Build path into the application view catalog for a given tab. */
export function applicationViewPath(applicationId, tabId = APP_VIEW_TAB_IDS.OVERVIEW) {
  const id = String(applicationId || '').trim();
  if (!id) return '/application-view';
  const tab = tabId && tabId !== APP_VIEW_TAB_IDS.OVERVIEW ? `?tab=${tabId}` : '';
  return `/application-view/${id}${tab}`;
}
