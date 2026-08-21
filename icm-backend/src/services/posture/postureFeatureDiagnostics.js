import { getPostureFeatureById } from "./postureFeatureRegistry.js";

/**
 * @param {object} params
 * @returns {object}
 */
export function createFeatureDiagnostic({
  featureKey,
  executionMode = null,
  ldapFilter = null,
  searchBase = null,
  searchScope = null,
  registryDefaultFilter = null,
  overrideUsed = false,
  ldapObjectsReturned = 0,
  ldapObjectsByType = null,
  normalizedObjects = 0,
  findingsGenerated = 0,
  findingsPersisted = 0,
  findingsDisplayed = 0,
  elapsedMs = 0,
  moduleId = null,
}) {
  const feature = getPostureFeatureById(featureKey);
  return {
    featureKey,
    featureName: feature?.name || featureKey,
    moduleId: moduleId || feature?.moduleId || null,
    executionMode: executionMode || feature?.executionMode || null,
    ldapFilter: ldapFilter || null,
    searchBase: searchBase || null,
    searchScope: searchScope || feature?.searchScope || "Subtree",
    registryDefaultFilter:
      registryDefaultFilter ?? feature?.defaultFilter ?? feature?.ldapFilter ?? null,
    overrideUsed: Boolean(overrideUsed),
    ldapObjectsReturned,
    ldapObjectsByType: ldapObjectsByType || null,
    normalizedObjects,
    findingsGenerated,
    findingsPersisted,
    findingsDisplayed,
    elapsedMs,
  };
}

/**
 * Log a formatted feature execution block to the console.
 * @param {object} diagnostic
 */
export function logFeatureDiagnostic(diagnostic) {
  const byType = diagnostic.ldapObjectsByType
    ? Object.entries(diagnostic.ldapObjectsByType)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    : null;
  const lines = [
    "================================",
    `Feature: ${diagnostic.featureName || diagnostic.featureKey}`,
    `Execution Mode: ${diagnostic.executionMode || "(unknown)"}`,
    `Effective Search Base: ${diagnostic.searchBase || "(none)"}`,
    `Effective LDAP Filter: ${diagnostic.ldapFilter || "(none)"}`,
    `Effective Search Scope: ${diagnostic.searchScope || "Subtree"}`,
    `Registry Default Filter: ${diagnostic.registryDefaultFilter || "(none)"}`,
    `Override Used: ${diagnostic.overrideUsed ? "yes" : "no"}`,
    `LDAP Objects Returned: ${diagnostic.ldapObjectsReturned}${byType ? ` (${byType})` : ""}`,
    `Normalized Objects: ${diagnostic.normalizedObjects}`,
    `Findings Generated: ${diagnostic.findingsGenerated}`,
    `Findings Persisted: ${diagnostic.findingsPersisted}`,
    `Displayed: ${diagnostic.findingsDisplayed}`,
    `Execution Time: ${diagnostic.elapsedMs}ms`,
    "================================",
  ];
  console.log(lines.join("\n"));
}

/**
 * Count findings per feature key.
 * @param {object[]} findings
 * @returns {Record<string, number>}
 */
export function countFindingsByFeature(findings) {
  const counts = {};
  for (const f of findings || []) {
    const key = String(f?.feature || "").trim();
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Merge persisted/displayed counts into diagnostics after scan save.
 * @param {object[]} diagnostics
 * @param {Record<string, number>} persistedByFeature
 * @param {Record<string, number>} [displayedByFeature]
 */
export function finalizeFeatureDiagnostics(
  diagnostics,
  persistedByFeature,
  displayedByFeature = persistedByFeature,
) {
  return (diagnostics || []).map((d) => ({
    ...d,
    findingsPersisted: persistedByFeature[d.featureKey] ?? d.findingsGenerated ?? 0,
    findingsDisplayed: displayedByFeature[d.featureKey] ?? d.findingsGenerated ?? 0,
  }));
}

/**
 * @param {object[]} diagnostics
 */
export function logScanDiagnosticSummary(diagnostics) {
  if (!diagnostics?.length) return;
  console.log("[posture] Scan diagnostic summary");
  for (const d of diagnostics) {
    logFeatureDiagnostic(d);
  }
}
