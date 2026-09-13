import { randomUUID } from "crypto";
import { fetchAdGroupLdapEntries, normalizeAdConfig } from "../adLdapService.js";
import { normalizeGroup, normalizeDn } from "../ldapNormalizer.js";
import { getAttrFirst, getAttrValues, getMemberDnsFromEntry, hasLdapMemberAttribute } from "../../utils/ldapEntryAttributes.js";
import { buildGroupRiskFinding } from "./utils/adSecurityHelpers.js";
import { PRIVILEGED_NAME_TOKENS } from "../graph/graphConstants.js";
import {
  resolveFeatureQuery,
  resolveFeatureLdapFilter,
} from "./postureFeatureLdap.js";
import {
  createFeatureDiagnostic,
  logFeatureDiagnostic,
} from "./postureFeatureDiagnostics.js";
import { GROUP_LDAP_SECURITY_FEATURES } from "./postureFeatureIds.js";
import {
  GRAPH_CATALOG_GROUP_FEATURES,
  buildGroupAnalysisCatalog,
  buildScopedGroupCatalog,
  getDirectMemberCount,
  hasNoDirectMembers,
  getIncomingParentCountInScope,
  resolveGraphGroupSearchBase,
  summarizeGroupGraph,
  findingDns,
  findingNames,
} from "./groupAnalysisCatalog.js";

export { GROUP_LDAP_SECURITY_FEATURES };

const LDAP_DIRECT_FEATURES = new Set(["empty_groups", "groups_without_owners"]);

/**
 * @param {import('ldapts').Entry|object} entry
 */
export function toPostureGroupFromEntry(entry) {
  const n = normalizeGroup(entry);
  const members = getMemberDnsFromEntry(entry);
  return {
    groupName: n.groupName,
    displayName: n.groupName,
    distinguishedName: n.groupDN,
    dn: n.groupDN,
    description: n.description || getAttrFirst(entry, "description") || "",
    objectSid: n.objectSid,
    members,
    memberAttributePresent: hasLdapMemberAttribute(entry),
    managedBy: getAttrFirst(entry, "managedBy") || "",
    memberOf: getAttrValues(entry, "memberOf"),
    rawData: n._raw,
  };
}

/**
 * Fetch posture groups using an explicit feature LDAP filter and optional search base.
 * @param {object} adConfig normalized AD config
 * @param {{ ldapFilter: string, searchBase?: string, maxGroups?: number }} options
 */
export async function fetchNormalizedPostureGroups(adConfig, options = {}) {
  const cfg = normalizeAdConfig(adConfig);
  const searchBase = options.searchBase?.trim() || options.baseDn?.trim();
  const entries = await fetchAdGroupLdapEntries(cfg, {
    maxGroups: options.maxGroups ?? cfg.maxGroups,
    ldapFilter: options.ldapFilter,
    searchBase: searchBase || undefined,
    baseDn: searchBase || undefined,
    searchScope: options.searchScope,
  });
  return entries.map((entry) => toPostureGroupFromEntry(entry));
}

function logGroupFeatureInstrumentation({
  featureId,
  searchBase,
  ldapFilter,
  catalog,
  scoped,
  groupsEvaluated,
  findings,
}) {
  const graph = summarizeGroupGraph(catalog, scoped);
  const parentChildLines = [];
  for (const [parentDn, children] of scoped.parentToChild.entries()) {
    for (const childDn of children) {
      parentChildLines.push(`${parentDn} -> ${childDn}`);
    }
  }

  const childParentLines = [];
  for (const [key, group] of scoped.groups.entries()) {
    const dn = group.distinguishedName || group.dn || "";
    for (const parentDn of catalog.childToParent.get(normalizeDn(dn)) || []) {
      if (!scoped.groups.has(normalizeDn(parentDn))) continue;
      childParentLines.push(`${parentDn} -> ${dn}`);
    }
  }

  console.log("----------------------------------------");
  console.log(`Feature: ${featureId}`);
  console.log(`Search Base: ${searchBase || "(application default)"}`);
  console.log(`LDAP Filter: ${ldapFilter}`);
  console.log(`Total Groups Loaded (graph): ${graph.totalGroupsLoaded}`);
  console.log(`Scoped Groups Loaded: ${graph.scopedGroupsLoaded}`);
  console.log(`Parent->Child edges: ${graph.parentChildEdges}`);
  console.log(`Child->Parent edges: ${graph.childParentEdges}`);
  console.log(`Number of Root Groups: ${graph.rootGroups}`);
  console.log(`Groups Evaluated: ${groupsEvaluated}`);
  console.log(`Groups Returned: ${findings.length}`);
  console.log(`Matching group names: ${findingNames(findings).join(", ") || "(none)"}`);
  console.log(`Matching DNs: ${findingDns(findings).join("; ") || "(none)"}`);
  if (parentChildLines.length) {
    console.log(`Parent->Child edge list:\n  ${parentChildLines.join("\n  ")}`);
  }
  if (childParentLines.length) {
    console.log(`Child->Parent edge list:\n  ${childParentLines.join("\n  ")}`);
  }
  console.log("----------------------------------------");
}

/**
 * Unused: zero direct members AND no incoming parent group references (PowerShell verifier).
 * @param {{ catalog: object, scoped: object, scanId: string }} ctx
 */
export function analyzeUnusedGroupsLdap(ctx) {
  const { catalog, scoped, scanId } = ctx;
  const findings = [];
  let evaluated = 0;
  let skippedHasMembers = 0;
  let skippedHasParents = 0;

  for (const group of scoped.groups.values()) {
    evaluated += 1;
    const dn = group.distinguishedName || group.dn || "";
    const memberCount = getDirectMemberCount(group);
    if (!hasNoDirectMembers(group)) {
      skippedHasMembers += 1;
      continue;
    }

    const parentCount = getIncomingParentCountInScope(catalog, scoped, dn);
    if (parentCount > 0) {
      skippedHasParents += 1;
      continue;
    }

    findings.push(
      buildGroupRiskFinding({
        scanId,
        feature: "unused_groups",
        group,
        status: "empty",
        metadata: { directMemberCount: memberCount, parentGroupCount: parentCount },
        findingSignals: ["UNUSED_GROUP"],
      }),
    );
  }

  console.log(
    `[unused_groups] evaluated=${evaluated} skippedMembers=${skippedHasMembers} skippedParents=${skippedHasParents} matched=${findings.length}`,
  );

  return { findings, groupsEvaluated: evaluated };
}

/**
 * Orphan: zero members, no managedBy, no incoming parent references within search base.
 * @param {{ catalog: object, scoped: object, scanId: string }} ctx
 */
export function analyzeOrphanGroupsLdap(ctx) {
  const { catalog, scoped, scanId } = ctx;
  const findings = [];
  let evaluated = 0;
  let skippedHasMembers = 0;
  let skippedHasParents = 0;
  let skippedHasOwner = 0;

  for (const group of scoped.groups.values()) {
    evaluated += 1;
    const dn = group.distinguishedName || group.dn || "";
    const memberCount = getDirectMemberCount(group);
    if (!hasNoDirectMembers(group)) {
      skippedHasMembers += 1;
      continue;
    }

    const parentCount = getIncomingParentCountInScope(catalog, scoped, dn);
    if (parentCount > 0) {
      skippedHasParents += 1;
      continue;
    }

    if (group.managedBy?.trim()) {
      skippedHasOwner += 1;
      continue;
    }

    findings.push(
      buildGroupRiskFinding({
        scanId,
        feature: "orphan_groups",
        group,
        status: "orphan",
        metadata: { directMemberCount: memberCount, parentGroupCount: parentCount },
        findingSignals: ["ORPHAN_GROUP"],
      }),
    );
  }

  console.log(
    `[orphan_groups] evaluated=${evaluated} skippedMembers=${skippedHasMembers} skippedParents=${skippedHasParents} skippedOwner=${skippedHasOwner} matched=${findings.length}`,
  );

  return { findings, groupsEvaluated: evaluated };
}

/**
 * Duplicate: identical non-empty Description values (test.ps1 / verifier parity).
 * @param {{ scoped: object, scanId: string }} ctx
 */
export function analyzeDuplicateGroupsLdap(ctx) {
  const { scoped, scanId } = ctx;
  /** @type {Map<string, object[]>} */
  const byDescription = new Map();
  let evaluated = 0;

  for (const group of scoped.groups.values()) {
    evaluated += 1;
    const description = String(group.description || "").trim();
    if (!description) continue;
    const key = description.toLowerCase();
    const list = byDescription.get(key) || [];
    list.push(group);
    byDescription.set(key, list);
  }

  const findings = [];
  for (const [, dupes] of byDescription) {
    if (dupes.length < 2) continue;
    const relatedNames = dupes.map((g) => g.groupName || g.displayName).join(", ");
    for (const group of dupes) {
      findings.push(
        buildGroupRiskFinding({
          scanId,
          feature: "duplicate_groups",
          group,
          status: "duplicate_description",
          metadata: {
            duplicateField: "Description",
            duplicateValue: group.description,
            duplicateCount: dupes.length,
            relatedNames,
          },
          findingSignals: ["DUPLICATE_GROUP"],
        }),
      );
    }
  }

  return { findings, groupsEvaluated: evaluated };
}

/**
 * Nested: every parent→child group edge reachable by recursive traversal (test.ps1 parity).
 * Each finding uses the child group DN.
 * @param {{ scoped: object, scanId: string }} ctx
 */
export function analyzeNestedGroupsLdap(ctx) {
  const { scoped, scanId } = ctx;
  const findings = [];
  let evaluated = 0;

  /**
   * @param {string} startDn
   * @param {string} currentDn
   * @param {number} depth
   * @param {Set<string>} visited
   */
  function traverseNested(startDn, currentDn, depth, visited) {
    const children = scoped.parentToChild.get(currentDn) || [];
    for (const childDn of children) {
      const childKey = normalizeDn(childDn);
      if (visited.has(childKey)) continue;
      visited.add(childKey);

      const childGroup = scoped.groups.get(childKey);
      const startGroup = scoped.groups.get(normalizeDn(startDn));
      if (childGroup) {
        findings.push(
          buildGroupRiskFinding({
            scanId,
            feature: "nested_groups",
            group: childGroup,
            status: `nested_depth_${depth}`,
            metadata: {
              parentGroup: startGroup?.groupName || startDn,
              parentDn: startDn,
              childGroup: childGroup.groupName,
              childDn,
              depth,
            },
            findingSignals: ["NESTED_GROUP"],
          }),
        );
      }

      traverseNested(startDn, childDn, depth + 1, visited);
    }
  }

  for (const group of scoped.groups.values()) {
    evaluated += 1;
    const rootDn = group.distinguishedName || group.dn || "";
    const visited = new Set([normalizeDn(rootDn)]);
    traverseNested(rootDn, rootDn, 1, visited);
  }

  return { findings, groupsEvaluated: evaluated };
}

function isPrivilegedGroupName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  return PRIVILEGED_NAME_TOKENS.some((t) => n.includes(t));
}

/**
 * Nested privileged access — test.ps1 parity:
 * privileged-named group, at least one parent group in scope (memberOf),
 * and at least one direct non-group member (PRIVILEGED_ACCESS marker).
 * @param {{ catalog: object, scoped: object, scanId: string }} ctx
 */
export function analyzeNestedPrivilegedAccessLdap(ctx) {
  const { catalog, scoped, scanId } = ctx;
  const findings = [];
  let evaluated = 0;

  for (const group of scoped.groups.values()) {
    evaluated += 1;
    const name = group.groupName || group.displayName || "";
    if (!isPrivilegedGroupName(name)) continue;

    const dn = group.distinguishedName || group.dn || "";
    const parentCount = getIncomingParentCountInScope(catalog, scoped, dn);
    if (parentCount < 1) continue;

    const members = Array.isArray(group.members) ? group.members : [];
    const hasDirectUser = members.some((memberDn) => {
      const key = normalizeDn(memberDn);
      return Boolean(key) && !catalog.groupDnSet.has(key);
    });
    if (!hasDirectUser) continue;

    const parents = (catalog.childToParent.get(normalizeDn(dn)) || [])
      .filter((parentDn) => scoped.groups.has(normalizeDn(parentDn)))
      .map((parentDn) => {
        const parent = scoped.groups.get(normalizeDn(parentDn));
        return parent?.groupName || parentDn;
      });

    findings.push(
      buildGroupRiskFinding({
        scanId,
        feature: "nested_privileged_access",
        group,
        status: "privileged_inherited_via_nesting",
        metadata: {
          parentGroupCount: parents.length,
          parents: parents.join("; "),
          directMemberCount: getDirectMemberCount(group),
        },
        findingSignals: ["NESTED_PRIVILEGED_ACCESS", "PRIVILEGED_USER"],
      }),
    );
  }

  return { findings, groupsEvaluated: evaluated };
}

/**
 * Circular: one record per unique cycle path (test.ps1 parity).
 * @param {{ catalog: object, scoped: object, scanId: string }} ctx
 */
export function analyzeCircularMembershipsLdap(ctx) {
  const { scoped, scanId } = ctx;
  /** @type {Map<string, number>} 0=unvisited, 1=in stack, 2=done */
  const visitedState = new Map();
  /** @type {string[]} */
  const pathStack = [];
  /** @type {Set<string>} */
  const detectedCycles = new Set();
  const findings = [];
  let evaluated = 0;

  /**
   * @param {string} nodeDn
   */
  function traverseForCycles(nodeDn) {
    const nodeKey = normalizeDn(nodeDn);
    const state = visitedState.get(nodeKey);
    if (state != null) {
      if (state === 1) {
        const cycleStartIdx = pathStack.findIndex(
          (dn) => normalizeDn(dn) === nodeKey,
        );
        if (cycleStartIdx >= 0) {
          const cycleNodes = pathStack.slice(cycleStartIdx);
          cycleNodes.push(nodeDn);
          const cycleNames = cycleNodes.map((dn) => {
            const g = scoped.groups.get(normalizeDn(dn));
            return g?.groupName || dn;
          });
          const cyclePath = cycleNames.join(" -> ");
          if (!detectedCycles.has(cyclePath)) {
            detectedCycles.add(cyclePath);
            const group = scoped.groups.get(nodeKey);
            if (group) {
              findings.push(
                buildGroupRiskFinding({
                  scanId,
                  feature: "circular_memberships",
                  group,
                  status: "cycle_detected",
                  metadata: {
                    cycleLength: cycleNodes.length - 1,
                    cyclePath,
                    cycleGroups: cycleNames.join(" > "),
                  },
                  findingSignals: ["CIRCULAR_GROUP_MEMBERSHIP"],
                }),
              );
            }
          }
        }
      }
      return;
    }

    visitedState.set(nodeKey, 1);
    pathStack.push(nodeDn);

    for (const childDn of scoped.parentToChild.get(nodeDn) || []) {
      traverseForCycles(childDn);
    }

    visitedState.set(nodeKey, 2);
    pathStack.pop();
  }

  for (const group of scoped.groups.values()) {
    evaluated += 1;
    const dn = group.distinguishedName || group.dn || "";
    const key = normalizeDn(dn);
    if (!visitedState.has(key)) {
      traverseForCycles(dn);
    }
  }

  return { findings, groupsEvaluated: evaluated };
}

export function analyzeEmptyGroupsLdap(groups, scanId) {
  const findings = [];
  for (const group of groups) {
    findings.push(
      buildGroupRiskFinding({
        scanId,
        feature: "empty_groups",
        group,
        status: "empty",
        findingSignals: ["EMPTY_GROUP"],
      }),
    );
  }
  return findings;
}

export function analyzeGroupsWithoutOwnersLdap(groups, scanId) {
  const findings = [];
  for (const group of groups) {
    if (group.managedBy?.trim()) continue;
    findings.push(
      buildGroupRiskFinding({
        scanId,
        feature: "groups_without_owners",
        group,
        status: "no_owner",
        findingSignals: ["GROUP_WITHOUT_OWNER"],
      }),
    );
  }
  return findings;
}

const GRAPH_FEATURE_ANALYZERS = {
  unused_groups: analyzeUnusedGroupsLdap,
  orphan_groups: analyzeOrphanGroupsLdap,
  duplicate_groups: analyzeDuplicateGroupsLdap,
  nested_groups: analyzeNestedGroupsLdap,
  circular_memberships: analyzeCircularMembershipsLdap,
  nested_privileged_access: analyzeNestedPrivilegedAccessLdap,
};

const LDAP_FEATURE_ANALYZERS = {
  empty_groups: analyzeEmptyGroupsLdap,
  groups_without_owners: analyzeGroupsWithoutOwnersLdap,
};

function normalizeSelectedFeatures(selected) {
  const list = Array.isArray(selected) ? selected : GROUP_LDAP_SECURITY_FEATURES;
  const allowed = new Set(GROUP_LDAP_SECURITY_FEATURES);
  const out = list.map((f) => String(f).trim()).filter((f) => allowed.has(f));
  return out.length ? out : [...GROUP_LDAP_SECURITY_FEATURES];
}

/**
 * Run LDAP-backed group posture features with per-feature search base overrides.
 */
export async function runGroupLdapSecurityScan({
  applicationId,
  adConfig,
  features,
  options = {},
}) {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();
  const cfg = normalizeAdConfig(adConfig);
  const featureList = normalizeSelectedFeatures(features);
  const queryOverrides = options.queryOverrides || {};

  const { isAdShieldEnabled } = await import("../security/adShield/adShieldClient.js");
  if (isAdShieldEnabled()) {
    const { runAdShieldPostureFeatures } = await import(
      "../security/adShield/adShieldPostureAdapter.js"
    );
    const adShieldResult = await runAdShieldPostureFeatures({
      adConfig: cfg,
      features: featureList,
      scanId,
      queryOverrides,
      maxObjects: options.maxGroups ?? cfg.maxGroups,
    });
    return {
      scanId,
      module: "group_ldap_security",
      applicationId: String(applicationId),
      startedAt,
      completedAt: new Date().toISOString(),
      groupCount:
        adShieldResult.diagnostics?.groupsScanned || 0,
      features: featureList,
      counts: adShieldResult.counts,
      findings: adShieldResult.findings,
      featureDiagnostics: adShieldResult.featureDiagnostics,
      summary: {
        totalFindings: adShieldResult.findings.length,
        byFeature: adShieldResult.counts,
      },
      source: "adshield",
      errors: adShieldResult.errors || [],
    };
  }

  const allFindings = [];
  const counts = Object.fromEntries(featureList.map((f) => [f, 0]));
  const featureDiagnostics = [];
  let totalGroupsFetched = 0;

  /** @type {Map<string, ReturnType<typeof buildGroupAnalysisCatalog>>} */
  const catalogByGraphBase = new Map();

  for (const featureId of featureList) {
    const resolved = resolveFeatureQuery(featureId, queryOverrides, cfg);
    const ldapFilter = resolved.ldapFilter;
    const searchBase = resolved.searchBaseDn;
    const t0 = Date.now();

    if (LDAP_DIRECT_FEATURES.has(featureId)) {
      const groups = await fetchNormalizedPostureGroups(cfg, {
        maxGroups: options.maxGroups ?? cfg.maxGroups,
        ldapFilter,
        searchBase,
        searchScope: resolved.searchScope,
      });
      const analyzer = LDAP_FEATURE_ANALYZERS[featureId];
      const findings = analyzer ? analyzer(groups, scanId) : [];
      allFindings.push(...findings);
      counts[featureId] = findings.length;
      totalGroupsFetched += groups.length;

      const diagnostic = createFeatureDiagnostic({
        featureKey: featureId,
        executionMode: resolved.executionMode,
        ldapFilter,
        searchBase,
        searchScope: resolved.searchScope,
        registryDefaultFilter: resolved.registryDefaultFilter,
        overrideUsed: resolved.overrideUsed,
        ldapObjectsReturned: groups.length,
        ldapObjectsByType: { group: groups.length },
        normalizedObjects: groups.length,
        findingsGenerated: findings.length,
        elapsedMs: Date.now() - t0,
        moduleId: "group_ldap_security",
      });
      featureDiagnostics.push(diagnostic);
      logFeatureDiagnostic(diagnostic);
      continue;
    }

    if (!GRAPH_CATALOG_GROUP_FEATURES.has(featureId)) continue;

    // Same search base for LDAP load + graph (test.ps1 parity). Cache per base+filter.
    const graphSearchBase = resolveGraphGroupSearchBase(searchBase, cfg);
    const graphFilter =
      resolveFeatureLdapFilter("unused_groups", queryOverrides) || ldapFilter;
    const catalogCacheKey = `${graphSearchBase}\0${graphFilter}\0${resolved.searchScope}`;
    let catalog = catalogByGraphBase.get(catalogCacheKey);
    if (!catalog) {
      const graphGroups = await fetchNormalizedPostureGroups(cfg, {
        maxGroups: options.maxGroups ?? cfg.maxGroups,
        ldapFilter: graphFilter,
        searchBase: graphSearchBase,
        searchScope: resolved.searchScope,
      });
      catalog = buildGroupAnalysisCatalog(graphGroups);
      catalogByGraphBase.set(catalogCacheKey, catalog);
      totalGroupsFetched += graphGroups.length;
      console.log(
        `[GROUP GRAPH] Loaded ${graphGroups.length} groups from search base ${graphSearchBase}`,
      );
    }

    const scoped = buildScopedGroupCatalog(
      catalog,
      searchBase || graphSearchBase,
    );
    const analyzer = GRAPH_FEATURE_ANALYZERS[featureId];
    const result = analyzer
      ? analyzer({ catalog, scoped, scanId })
      : { findings: [], groupsEvaluated: 0 };
    const findings = result.findings || [];

    logGroupFeatureInstrumentation({
      featureId,
      searchBase: searchBase || graphSearchBase,
      ldapFilter,
      catalog,
      scoped,
      groupsEvaluated: result.groupsEvaluated ?? scoped.groupCount,
      findings,
    });

    console.log(`[GROUP VERIFY] ${featureId}`);
    console.log(`Application Count: ${findings.length}`);
    console.log(
      `Application DNs: ${findingDns(findings).join("; ") || "(none)"}`,
    );

    allFindings.push(...findings);
    counts[featureId] = findings.length;

    const diagnostic = createFeatureDiagnostic({
      featureKey: featureId,
      executionMode: resolved.executionMode,
      ldapFilter,
      searchBase: searchBase || graphSearchBase,
      searchScope: resolved.searchScope,
      registryDefaultFilter: resolved.registryDefaultFilter,
      overrideUsed: resolved.overrideUsed,
      ldapObjectsReturned: scoped.groupCount,
      ldapObjectsByType: { group: scoped.groupCount },
      normalizedObjects: catalog.groupCount,
      findingsGenerated: findings.length,
      elapsedMs: Date.now() - t0,
      moduleId: "group_ldap_security",
    });
    featureDiagnostics.push(diagnostic);
    logFeatureDiagnostic(diagnostic);
  }

  return {
    scanId,
    module: "group_ldap_security",
    applicationId: String(applicationId),
    startedAt,
    completedAt: new Date().toISOString(),
    groupCount: totalGroupsFetched,
    features: featureList,
    counts,
    findings: allFindings,
    featureDiagnostics,
    summary: {
      totalFindings: allFindings.length,
      byFeature: counts,
    },
  };
}

/** @deprecated Use buildGroupAnalysisCatalog from groupAnalysisCatalog.js */
export function buildGroupCatalogForTests(groups) {
  return buildGroupAnalysisCatalog(groups);
}

/**
 * Helper for unit tests — builds catalog + scope from an in-memory group list.
 */
export function analyzeGraphFeatureForTests(analyzer, groups, searchBase, scanId) {
  const catalog = buildGroupAnalysisCatalog(groups);
  const scoped = buildScopedGroupCatalog(catalog, searchBase);
  return analyzer({ catalog, scoped, scanId });
}
