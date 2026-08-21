/**
 * Seed candidates from ApplicationDetail tab keys (discovery helper).
 * Registry remains authoritative; this lists expected tabs for gap detection.
 */
export const APPLICATION_DETAIL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "schema", label: "Application schema" },
  { key: "users", label: "Current accounts", featureId: "feat.applications.accounts" },
  { key: "reconHistory", label: "Reconciliation history", featureId: "feat.applications.reconHistory" },
  { key: "deltaChanges", label: "Change logs", featureId: "feat.applications.changeLogs" },
  { key: "entitlementSchema", label: "Entitlement schema" },
  { key: "entitlements", label: "Entitlements", featureId: "feat.applications.entitlements" },
  { key: "adSuggestions", label: "AD suggestions", featureId: "feat.applications.adSuggestions" },
  { key: "correlation", label: "Correlation", featureId: "feat.applications.correlation" },
  { key: "settings", label: "Settings", featureId: "feat.applications.settings" },
];

export function missingApplicationFeatureTargets(registeredFeatureIds = []) {
  const set = new Set(registeredFeatureIds);
  return APPLICATION_DETAIL_TABS.filter((t) => t.featureId && !set.has(t.featureId));
}
