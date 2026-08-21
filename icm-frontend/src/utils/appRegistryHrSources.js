/**
 * App Registry row is usable as Identity Profile / HRMS delimited source when it has
 * `hrms.connector` (preferred) or persisted connectorType for HR / delimited catalog entries.
 */
export function isAppRegistryHrSourceCandidate(app) {
  if (!app) return false;
  if (app.hrms?.connector) return true;
  const u = String(app.connectorType || '').toUpperCase();
  return (
    u === 'HRMS_DELIMITED_FILE' ||
    u === 'HRMS_ORANGEHRM' ||
    u === 'CONNECTOR_DELIMITEDFILE' ||
    u === 'DELIMITEDFILE'
  );
}
