/**
 * Application connector helpers for UI (AD source vs derived AD child apps).
 */

export function isPrimaryAdConnectorApplication(app) {
  if (!app) return false;
  return (
    app.connectorType === 'ACTIVE_DIRECTORY' || Boolean(app.connectionConfig?.ad)
  );
}

/** Child app created from AD suggestions (scoped group membership). */
export function isDerivedAdApplication(app) {
  if (!app) return false;
  const sourceId = app.sourceApplicationId?._id || app.sourceApplicationId;
  return Boolean(sourceId && app.connectionConfig?.derivedAd);
}

export function getDerivedAdSourceApplicationId(app) {
  if (!isDerivedAdApplication(app)) return null;
  const raw = app.sourceApplicationId?._id || app.sourceApplicationId;
  return raw ? String(raw) : null;
}

/** Current accounts table uses LDAP attribute columns (same as source AD). */
export function usesAdLdapAccountsTable(app) {
  return isPrimaryAdConnectorApplication(app) || isDerivedAdApplication(app);
}

/** Account ↔ entitlement links are built from AD memberOf on sync (no manual schema correlation). */
export function usesAdAutoAccountEntitlementCorrelation(app) {
  return usesAdLdapAccountsTable(app);
}

/**
 * Delimited / CSV file connector (catalog CONNECTOR_DELIMITEDFILE or HRMS delimited_file).
 * Sync must upload a CSV — there is no remote endpoint to pull.
 */
export function isDelimitedFileConnectorApplication(app) {
  if (!app) return false;
  if (app.hrms?.connector === 'delimited_file' || app.connector === 'delimited_file') {
    return true;
  }
  const ct = String(app.connectorType || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!ct) return false;
  if (ct === 'CONNECTOR_DELIMITEDFILE' || ct === 'CONNECTOR_DELIMITED_FILE') return true;
  if (ct === 'HRMS_DELIMITED_FILE' || ct === 'DELIMITEDFILE') return true;
  if (ct.includes('DELIMITED') && ct.includes('FILE')) return true;
  return false;
}

/**
 * AD-derived child apps inherit type, owner, connector, and status from the source AD for display.
 * @param {object} app
 * @param {object | null | undefined} sourceApp
 */
export function resolveDerivedApplicationDisplay(app, sourceApp) {
  if (!isDerivedAdApplication(app) || !sourceApp) {
    return {
      type: app?.type,
      status: app?.status,
      owner: app?.owner,
      connectorType: app?.connectorType,
      isInherited: false,
    };
  }
  return {
    type: sourceApp.type || app.type,
    status: sourceApp.status || app.status,
    owner: sourceApp.owner || app.owner,
    connectorType: sourceApp.connectorType || app.connectorType,
    isInherited: true,
  };
}

export function isActiveDirectoryConnectorApp(app) {
  return (
    app?.connectorType === 'ACTIVE_DIRECTORY' || Boolean(app?.connectionConfig?.ad)
  );
}
