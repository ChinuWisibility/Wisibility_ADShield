import {
  resolveFeatureQuery,
  countPostureObjects,
} from "./postureFeatureLdap.js";
import {
  createFeatureDiagnostic,
  logFeatureDiagnostic,
} from "./postureFeatureDiagnostics.js";

/**
 * Fetch posture objects for a resolved feature query, keyed by object type.
 * Dynamic imports avoid circular deps with module scan runners.
 * @param {object} cfg normalized AD config
 * @param {ReturnType<typeof resolveFeatureQuery>} resolved
 * @param {object} [options]
 * @returns {Promise<{ user?: object[], computer?: object[], group?: object[] }>}
 */
export async function fetchPostureObjectsForFeature(cfg, resolved, options = {}) {
  const searchBase = resolved.searchBaseDn || undefined;
  const ldapFilter = resolved.ldapFilter;
  const searchScope = resolved.searchScope;
  const types = new Set(resolved.objectTypes || []);
  const out = {};
  const tasks = [];

  if (types.has("user")) {
    tasks.push(
      (async () => {
        const { fetchNormalizedPostureUsers } = await import("./userAccountSecurity.js");
        out.user = await fetchNormalizedPostureUsers(cfg, {
          maxUsers: options.maxUsers ?? cfg.maxUsers,
          ldapFilter,
          searchBase,
          searchScope,
        });
      })(),
    );
  }
  if (types.has("computer")) {
    tasks.push(
      (async () => {
        const { fetchNormalizedPostureComputers } = await import("./postureDirectoryService.js");
        out.computer = await fetchNormalizedPostureComputers(cfg, {
          maxComputers: options.maxComputers,
          ldapFilter,
          searchBase,
          searchScope,
        });
      })(),
    );
  }
  if (types.has("group")) {
    tasks.push(
      (async () => {
        const { fetchNormalizedPostureGroups } = await import("./groupLdapSecurity.js");
        out.group = await fetchNormalizedPostureGroups(cfg, {
          maxGroups: options.maxGroups,
          ldapFilter,
          searchBase,
          searchScope,
        });
      })(),
    );
  }

  await Promise.all(tasks);
  return out;
}

/**
 * Shared LDAP feature scan loop used by User / Computer / Kerberos / Delegation modules.
 *
 * @param {object} params
 * @param {string} params.moduleId
 * @param {string[]} params.featureList
 * @param {object} params.cfg normalized AD config
 * @param {object} [params.queryOverrides]
 * @param {object} [params.fetchOptions]
 * @param {(featureId: string, objects: object, resolved: object) => { findings: object[], count?: number }} params.analyzeFeature
 * @returns {Promise<{ findings: object[], counts: Record<string, number>, featureDiagnostics: object[], objectTotals: object }>}
 */
export async function runLdapFeatureScanLoop({
  moduleId,
  featureList,
  cfg,
  queryOverrides = {},
  fetchOptions = {},
  analyzeFeature,
}) {
  const allFindings = [];
  const counts = Object.fromEntries((featureList || []).map((f) => [f, 0]));
  const featureDiagnostics = [];
  const objectTotals = { user: 0, computer: 0, group: 0 };

  for (const featureId of featureList || []) {
    const resolved = resolveFeatureQuery(featureId, queryOverrides, cfg);
    const t0 = Date.now();

    const objects = await fetchPostureObjectsForFeature(cfg, resolved, fetchOptions);
    const { total, byType } = countPostureObjects(objects);
    for (const [type, n] of Object.entries(byType)) {
      objectTotals[type] = (objectTotals[type] || 0) + n;
    }

    const analysis = analyzeFeature(featureId, objects, resolved) || {
      findings: [],
      count: 0,
    };
    const findings = analysis.findings || [];
    const generated = analysis.count ?? findings.length;

    allFindings.push(...findings);
    counts[featureId] = generated;

    const diagnostic = createFeatureDiagnostic({
      featureKey: featureId,
      executionMode: resolved.executionMode,
      ldapFilter: resolved.ldapFilter,
      searchBase: resolved.searchBaseDn,
      searchScope: resolved.searchScope,
      registryDefaultFilter: resolved.registryDefaultFilter,
      overrideUsed: resolved.overrideUsed,
      ldapObjectsReturned: total,
      ldapObjectsByType: byType,
      normalizedObjects: total,
      findingsGenerated: generated,
      elapsedMs: Date.now() - t0,
      moduleId,
    });
    featureDiagnostics.push(diagnostic);
    logFeatureDiagnostic(diagnostic);
  }

  return {
    findings: allFindings,
    counts,
    featureDiagnostics,
    objectTotals,
  };
}
