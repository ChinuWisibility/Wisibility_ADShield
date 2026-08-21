/**
 * Entitlement fields stored in DB but never shown in application entitlement tables.
 */
export const HIDDEN_ENTITLEMENT_UI_FIELDS = new Set([
  'entitlement_id',
]);

export function isHiddenEntitlementUiField(standardField) {
  const key = String(standardField || '').trim().toLowerCase();
  return HIDDEN_ENTITLEMENT_UI_FIELDS.has(key);
}

export function filterEntitlementColumnDefs(defs = []) {
  return defs.filter((d) => !isHiddenEntitlementUiField(d.key));
}
