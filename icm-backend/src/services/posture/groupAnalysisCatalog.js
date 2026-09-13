import { normalizeDn } from "../ad/ldapNormalizer.js";

/** Features that share one in-memory group graph (PowerShell verifier parity). */
export const GRAPH_CATALOG_GROUP_FEATURES = new Set([
  "unused_groups",
  "orphan_groups",
  "duplicate_groups",
  "nested_groups",
  "circular_memberships",
  "nested_privileged_access",
]);

/**
 * @param {string} dn
 * @param {string} searchBase
 */
export function isDnUnderSearchBase(dn, searchBase) {
  const normalizedDn = normalizeDn(dn);
  const normalizedBase = normalizeDn(searchBase);
  if (!normalizedDn || !normalizedBase) return false;
  return normalizedDn === normalizedBase || normalizedDn.endsWith(`,${normalizedBase}`);
}

/**
 * Wider LDAP base for group graph edges — only when explicitly configured.
 * Default: use the same search base as the feature (test.ps1 / Scan Center parity).
 * @param {string} featureSearchBase
 * @param {{ baseDn?: string, graphGroupSearchBase?: string, graphGroupBaseDn?: string, baseDns?: string[] }} [cfg]
 */
export function resolveGraphGroupSearchBase(featureSearchBase, cfg = {}) {
  const explicit =
    cfg.graphGroupSearchBase?.trim() || cfg.graphGroupBaseDn?.trim() || "";
  if (explicit) return explicit;

  return (
    featureSearchBase?.trim() ||
    cfg.baseDn?.trim() ||
    cfg.baseDns?.[0]?.trim() ||
    ""
  );
}

/**
 * @param {string} key
 * @param {string} value
 * @param {Map<string, string[]>} map
 */
function addMapListValue(map, key, value) {
  const normKey = normalizeDn(key);
  if (!normKey || !value?.trim()) return;
  const list = map.get(normKey) || [];
  const normValue = normalizeDn(value);
  if (list.some((existing) => normalizeDn(existing) === normValue)) return;
  list.push(value);
  map.set(normKey, list);
}

/**
 * Build the full group graph from every group returned by LDAP (graph search base).
 * Parent references use the complete loaded set — not scoped to the feature OU.
 * @param {object[]} groups normalized posture groups
 */
export function buildGroupAnalysisCatalog(groups) {
  /** @type {Map<string, object>} */
  const byDn = new Map();
  /** @type {Set<string>} */
  const groupDnSet = new Set();

  for (const group of groups) {
    const dn = group.distinguishedName || group.dn || "";
    const key = normalizeDn(dn);
    if (!key) continue;
    byDn.set(key, group);
    groupDnSet.add(key);
  }

  /** incoming parent group DNs (child norm key -> parent DNs) */
  const parentGroupMap = new Map();
  /** outgoing child group DNs (parent norm key -> child DNs) */
  const childGroupMap = new Map();
  /** parent norm key -> child norm keys (group members only) */
  const nestedAdj = new Map();
  /** parent DN -> child group DNs (test.ps1 parentToChild) */
  const parentToChild = new Map();
  /** child DN -> parent group DNs (test.ps1 childToParent) */
  const childToParent = new Map();

  for (const group of groups) {
    const parentDn = group.distinguishedName || group.dn || "";
    const parentKey = normalizeDn(parentDn);
    if (!parentKey) continue;

    const childDnList = [];
    const childKeys = [];

    for (const memberDn of group.members || []) {
      const memberKey = normalizeDn(memberDn);
      if (!memberKey || !groupDnSet.has(memberKey)) continue;

      const childGroup = byDn.get(memberKey);
      const childKeyDn =
        childGroup?.distinguishedName || childGroup?.dn || memberDn;

      childKeys.push(memberKey);
      childDnList.push(childKeyDn);
      addMapListValue(parentGroupMap, childKeyDn, parentDn);
      addMapListValue(childToParent, childKeyDn, parentDn);

      const childMapKey = normalizeDn(parentDn);
      const existingChildren = childGroupMap.get(childMapKey) || [];
      if (!existingChildren.some((dn) => normalizeDn(dn) === memberKey)) {
        existingChildren.push(memberDn);
        childGroupMap.set(childMapKey, existingChildren);
      }
    }

    if (childDnList.length > 0) {
      parentToChild.set(parentDn, childDnList);
      nestedAdj.set(parentKey, childKeys);
    }
  }

  // Supplement incoming parent links from memberOf (LDAP child attribute is often
  // more complete than member on the parent object — matches Get-ADGroup graphs).
  for (const group of groups) {
    const childKeyDn = group.distinguishedName || group.dn || "";
    const childKey = normalizeDn(childKeyDn);
    if (!childKey) continue;

    for (const parentDn of group.memberOf || []) {
      const parentKey = normalizeDn(parentDn);
      if (!parentKey || !groupDnSet.has(parentKey)) continue;
      addMapListValue(childToParent, childKeyDn, parentDn);
      addMapListValue(parentGroupMap, childKeyDn, parentDn);
    }
  }

  return {
    byDn,
    groupDnSet,
    parentGroupMap,
    childGroupMap,
    nestedAdj,
    parentToChild,
    childToParent,
    groupCount: byDn.size,
  };
}

/**
 * Scope graph analysis to the feature search base (matches Build-GroupCatalog / test.ps1 scope).
 * @param {ReturnType<typeof buildGroupAnalysisCatalog>} catalog
 * @param {string} searchBase
 */
export function buildScopedGroupCatalog(catalog, searchBase) {
  /** @type {Map<string, object>} */
  const groups = new Map();
  /** @type {Map<string, string[]>} */
  const nestedAdj = new Map();
  /** parent DN -> child DNs within scope */
  const parentToChild = new Map();

  for (const [key, group] of catalog.byDn.entries()) {
    const dn = group.distinguishedName || group.dn || "";
    if (!isDnUnderSearchBase(dn, searchBase)) continue;
    groups.set(key, group);
  }

  for (const [parentKey, childKeys] of catalog.nestedAdj.entries()) {
    if (!groups.has(parentKey)) continue;
    const scopedChildKeys = childKeys.filter((childKey) => groups.has(childKey));
    if (!scopedChildKeys.length) continue;
    nestedAdj.set(parentKey, scopedChildKeys);

    const parentDn = groups.get(parentKey)?.distinguishedName || groups.get(parentKey)?.dn;
    if (!parentDn) continue;
    parentToChild.set(
      parentDn,
      scopedChildKeys.map((childKey) => {
        const child = groups.get(childKey);
        return child?.distinguishedName || child?.dn || childKey;
      }),
    );
  }

  const rootGroupKeys = [];
  for (const [key, group] of groups.entries()) {
    const dn = group.distinguishedName || group.dn || "";
    if (getIncomingParentCountInScope(catalog, { groups }, dn) === 0) {
      rootGroupKeys.push(key);
    }
  }

  return {
    searchBase,
    groups,
    nestedAdj,
    parentToChild,
    rootGroupKeys,
    groupCount: groups.size,
  };
}

/**
 * PowerShell test.ps1 Get-DirectMemberCount parity: @($Group.Member).Count
 * Counts every direct member (users, computers, and nested groups).
 * @param {{ members?: string[]|null }} group
 */
export function getDirectMemberCount(group) {
  const members = group?.members;
  if (!Array.isArray(members)) return 0;
  return members.length;
}

/**
 * True when the group has no direct members of any kind (user or group).
 * @param {{ members?: string[]|null }} group
 */
export function hasNoDirectMembers(group) {
  return getDirectMemberCount(group) === 0;
}

/**
 * Incoming parent count visible within the feature search base (test.ps1 childToParent parity).
 * Only parents that were loaded in the scoped group set count — edges require both endpoints
 * in the same SearchBase load in PowerShell.
 * @param {ReturnType<typeof buildGroupAnalysisCatalog>} catalog
 * @param {ReturnType<typeof buildScopedGroupCatalog>} scoped
 * @param {string} dn
 */
export function getIncomingParentCountInScope(catalog, scoped, dn) {
  const parents = catalog.childToParent.get(normalizeDn(dn)) || [];
  let count = 0;
  for (const parentDn of parents) {
    if (scoped.groups.has(normalizeDn(parentDn))) count += 1;
  }
  return count;
}

/**
 * @param {Map<string, string[]>} parentGroupMap
 * @param {string} dn
 */
export function getIncomingParentCount(parentGroupMap, dn) {
  return parentGroupMap.get(normalizeDn(dn))?.length || 0;
}

/**
 * @param {ReturnType<typeof buildGroupAnalysisCatalog>} catalog
 * @param {ReturnType<typeof buildScopedGroupCatalog>} scoped
 */
export function summarizeGroupGraph(catalog, scoped) {
  let parentChildEdges = 0;
  let childParentEdges = 0;

  for (const children of scoped.parentToChild.values()) {
    parentChildEdges += children.length;
  }
  for (const [key, group] of scoped.groups.entries()) {
    const dn = group.distinguishedName || group.dn || "";
    childParentEdges += getIncomingParentCountInScope(catalog, scoped, dn);
  }

  return {
    totalGroupsLoaded: catalog.groupCount,
    scopedGroupsLoaded: scoped.groupCount,
    parentChildEdges,
    childParentEdges,
    rootGroups: scoped.rootGroupKeys.length,
  };
}

/**
 * @param {object} finding
 */
export function findingDn(finding) {
  return finding?.dn || finding?.distinguishedName || "";
}

/**
 * @param {object[]} findings
 */
export function findingDns(findings) {
  return findings.map((f) => findingDn(f)).filter(Boolean);
}

/**
 * @param {object[]} findings
 */
export function findingNames(findings) {
  return findings.map((f) => f.objectName || f.groupName || findingDn(f)).filter(Boolean);
}
