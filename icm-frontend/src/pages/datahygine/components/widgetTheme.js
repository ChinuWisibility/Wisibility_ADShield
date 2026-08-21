/**
 * Single source of truth for every widget's colour palette.
 * Both the card tile and the detail page import from here,
 * so they always match.
 *
 * Each widget has a unique hue (~45° apart), low saturation (~20–26%),
 * no vibrant accents.
 */
export const WIDGET_THEME = {
  orphanedProfiles: {
    main: '#967a62',
    light: '#faf7f4',
    dark: '#4a3d32',
    muted: '#ede5dc',
    gradient: 'linear-gradient(135deg, #967a62 0%, #7a6350 100%)',
    icon: '👤',
    description: 'Accounts with no matching authoritative identity',
  },
  missingManagers: {
    main: '#576d85',
    light: '#f4f7fa',
    dark: '#2e3d4d',
    muted: '#dde4ec',
    gradient: 'linear-gradient(135deg, #576d85 0%, #455870 100%)',
    icon: '🔗',
    description:
      'No manager, unresolved reference, or declared top of hierarchy (manager correlation)',
  },
  missingManagersByApplication: {
    main: '#4f8780',
    light: '#f2f8f7',
    dark: '#2a4a46',
    muted: '#d9ebe8',
    gradient: 'linear-gradient(135deg, #4f8780 0%, #3d6d67 100%)',
    icon: '🏢',
    description:
      'Same manager hygiene by tenant app (account link or identity source)',
  },
  managerMismatches: {
    main: '#2f6f77',
    light: '#f2fafb',
    dark: '#163b40',
    muted: '#d6eaed',
    gradient: 'linear-gradient(135deg, #2f6f77 0%, #24575d 100%)',
    icon: '↔️',
    description:
      'Accounts whose application manager does not match the identity profile manager',
  },
  statusMismatches: {
    main: '#8a5f4a',
    light: '#faf6f4',
    dark: '#4a3228',
    muted: '#ebdcd4',
    gradient: 'linear-gradient(135deg, #8a5f4a 0%, #6f4c3c 100%)',
    icon: '🔄',
    description:
      'Correlated accounts whose ACCOUNT STATUS does not match identity STATUS',
  },
  unassignedEntitlements: {
    main: '#5a8462',
    light: '#f3f8f4',
    dark: '#2f4a35',
    muted: '#dce8df',
    gradient: 'linear-gradient(135deg, #5a8462 0%, #476b4f 100%)',
    icon: '🔑',
    description: 'Entitlements with no linked user after correlation',
  },
  privilegedEntitlements: {
    main: '#916b70',
    light: '#faf6f6',
    dark: '#4a3538',
    muted: '#ebe0e1',
    gradient: 'linear-gradient(135deg, #916b70 0%, #735658 100%)',
    icon: '⚠️',
    description: 'Entitlements flagged as privileged',
  },
  entitlementsMissingOwner: {
    main: '#756d8f',
    light: '#f7f6fa',
    dark: '#3d384d',
    muted: '#e6e4eb',
    gradient: 'linear-gradient(135deg, #756d8f 0%, #5e5773 100%)',
    icon: '🏷️',
    description: 'Catalog entitlements with no owner on the extract',
  },
  inactiveUsersWithAccess: {
    main: '#9a8858',
    light: '#faf8f2',
    dark: '#4d4530',
    muted: '#ebe6d4',
    gradient: 'linear-gradient(135deg, #9a8858 0%, #7d6f47 100%)',
    icon: '🚫',
    description: 'Terminated users still holding active access',
  },
  accessCertificationCampaigns: {
    main: '#636d82',
    light: '#f6f7f9',
    dark: '#353a45',
    muted: '#e0e3e8',
    gradient: 'linear-gradient(135deg, #636d82 0%, #4f5668 100%)',
    icon: '📋',
    description: 'Access certification campaigns grouped by application',
  },
  sodPoliciesViolations: {
    main: '#7a5c6e',
    light: '#faf6f8',
    dark: '#3f2f38',
    muted: '#ebe0e5',
    gradient: 'linear-gradient(135deg, #7a5c6e 0%, #624958 100%)',
    icon: '⚖️',
    description: 'SoD policies and open violations scoped per application',
  },
  duplicateAccountsByApplication: {
    main: '#6b7a94',
    light: '#f5f7fa',
    dark: '#384252',
    muted: '#dfe4eb',
    gradient: 'linear-gradient(135deg, #6b7a94 0%, #556275 100%)',
    icon: '👥',
    description: 'Ingest PK collisions — multiple CSV/connector rows for the same account key',
  },
  _application: {
    main: '#4f6b82',
    light: '#f4f7fa',
    dark: '#2d3d4d',
    muted: '#dde5ec',
    gradient: 'linear-gradient(135deg, #4f6b82 0%, #3f5668 100%)',
    icon: '🏢',
    description: 'Application-wise data hygiene summary',
  },
  _default: {
    main: '#636d82',
    light: '#f6f7f9',
    dark: '#353a45',
    muted: '#e0e3e8',
    gradient: 'linear-gradient(135deg, #636d82 0%, #4f5668 100%)',
    icon: '📊',
    description: 'Data hygiene metric',
  },
};

/**
 * Application-wise dashboard palette — no pink/magenta; hues spaced for contrast.
 * Assign with getApplicationTileTheme(index) using tile display order (0, 1, 2…)
 * so each visible tile gets a unique colour until the palette is exhausted.
 */
export const APPLICATION_TILE_PALETTE = [
  { main: '#4a7fc1', light: '#e3eefb', dark: '#1e3f66', muted: '#b8d4f2', icon: '🏢' },
  { main: '#3d9a6e', light: '#dff5ea', dark: '#1f4d38', muted: '#a8dfc4', icon: '🏢' },
  { main: '#6b4fa0', light: '#ede4f8', dark: '#3f2860', muted: '#cdb8ea', icon: '🏢' },
  { main: '#d06a42', light: '#fce9e0', dark: '#6e3620', muted: '#f2b89a', icon: '🏢' },
  { main: '#2a9494', light: '#daf3f3', dark: '#144a4a', muted: '#9ad9d9', icon: '🏢' },
  { main: '#5a52a8', light: '#e6e4f5', dark: '#2e2a5c', muted: '#b8b4e8', icon: '🏢' },
  { main: '#c4922a', light: '#faf0d6', dark: '#6a5016', muted: '#ecd898', icon: '🏢' },
  { main: '#2f86a8', light: '#dceef6', dark: '#184456', muted: '#9ecfe6', icon: '🏢' },
  { main: '#7a9230', light: '#edf2d4', dark: '#3e4c18', muted: '#c8d88a', icon: '🏢' },
  { main: '#5c6b7a', light: '#e8ecef', dark: '#303a42', muted: '#c4cdd6', icon: '🏢' },
  { main: '#1f6b8c', light: '#d8ebf2', dark: '#103848', muted: '#98c8dc', icon: '🏢' },
  { main: '#8a6840', light: '#f2e8d8', dark: '#483620', muted: '#dcc0a0', icon: '🏢' },
  { main: '#2d6b4f', light: '#d8ebe2', dark: '#173628', muted: '#a0d0bc', icon: '🏢' },
  { main: '#8b6914', light: '#f5edd8', dark: '#4a3810', muted: '#e0c890', icon: '🏢' },
  { main: '#456b8c', light: '#dfe8f0', dark: '#243848', muted: '#afc4d8', icon: '🏢' },
  { main: '#6a7c2e', light: '#eef2dc', dark: '#384018', muted: '#c8d4a0', icon: '🏢' },
];

/** @param {number} index — 0-based position in the application tiles list */
export function getApplicationTileTheme(index = 0) {
  const palette = APPLICATION_TILE_PALETTE;
  const i = ((Number(index) % palette.length) + palette.length) % palette.length;
  const entry = palette[i];
  return { ...entry, gradient: entry.main };
}

/**
 * Detail page theme: metric colours by default; application tile colours when
 * opened from the Applications dashboard (via appThemeIndex or cached tile order).
 */
export function resolveDataHygieneDetailTheme(
  widgetId,
  { dashboardView, appThemeIndex, applicationId, cachedSummary } = {},
) {
  const metricTheme = WIDGET_THEME[widgetId] || WIDGET_THEME._default;
  if (dashboardView !== 'application') {
    return metricTheme;
  }

  let index = -1;
  const parsed = Number(appThemeIndex);
  if (appThemeIndex != null && appThemeIndex !== '' && !Number.isNaN(parsed)) {
    index = parsed;
  } else if (
    applicationId != null &&
    applicationId !== '' &&
    Array.isArray(cachedSummary?.applicationTiles)
  ) {
    index = cachedSummary.applicationTiles.findIndex(
      (tile) => tile.applicationId != null && String(tile.applicationId) === String(applicationId),
    );
  }

  if (index < 0) {
    return metricTheme;
  }

  const appTheme = getApplicationTileTheme(index);
  return {
    ...appTheme,
    gradient: `linear-gradient(135deg, ${appTheme.main} 0%, ${appTheme.dark} 100%)`,
    icon: metricTheme.icon,
    description: metricTheme.description,
  };
}
