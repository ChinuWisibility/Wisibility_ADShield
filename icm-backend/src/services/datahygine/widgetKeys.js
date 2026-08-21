/** Widget ids supported by GET /api/data-hygiene/widget-items */
export const WIDGET_ITEM_KEYS = new Set([
  "orphanedProfiles",
  "missingManagers",
  "missingManagersByApplication",
  "managerMismatches",
  "statusMismatches",
  "unassignedEntitlements",
  "privilegedEntitlements",
  "entitlementsMissingOwner",
  "inactiveUsersWithAccess",
  "accessCertificationCampaigns",
  "sodPoliciesViolations",
  "duplicateAccountsByApplication",
]);

export const MAX_WIDGET_DETAIL_PAGE_SIZE = 100;

/** Omitted from Applications dashboard tiles; still shown on the Metrics view. */
export const APPLICATION_TILE_EXCLUDED_WIDGET_IDS = new Set(["missingManagers"]);
