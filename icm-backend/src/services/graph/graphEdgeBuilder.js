import { normalizeDn } from "../ad/ldapNormalizer.js";
import { GRAPH_EDGE_TYPES, GRAPH_NODE_TYPES } from "./graphConstants.js";
import {
  extractGroupMemberDns,
  extractGroupMemberOfDns,
  extractUserGroupDns,
  resolveGroupNodeFromEntitlement,
  resolveGroupNodeId,
  resolveUserNodeFromDoc,
} from "./graphNodeResolver.js";
import { isPrivilegedEntitlement } from "../identity/posture/identityPostureDashboard.js";

/**
 * Build edge documents ready for bulkWrite (no DB).
 * @param {object} ctx
 * @param {string|import('mongoose').Types.ObjectId} ctx.tenantId
 * @param {string|import('mongoose').Types.ObjectId} ctx.applicationId
 * @param {Map<string, string>} ctx.dnToGroupNodeId - normalized DN → group node id
 */
export function buildMemberOfEdgesForUser(tenantId, applicationId, userDoc, dnToGroupNodeId) {
  const sourceNodeId = resolveUserNodeFromDoc(tenantId, applicationId, userDoc);
  if (!sourceNodeId) return [];

  const edges = [];
  for (const dn of extractUserGroupDns(userDoc)) {
    const norm = normalizeDn(dn);
    const targetNodeId = dnToGroupNodeId.get(norm);
    if (!targetNodeId) continue;
    edges.push({
      tenantId,
      applicationId,
      sourceNodeId,
      sourceType: GRAPH_NODE_TYPES.USER,
      targetNodeId,
      targetType: GRAPH_NODE_TYPES.GROUP,
      relationshipType: GRAPH_EDGE_TYPES.MEMBER_OF,
      metadata: { directDn: dn },
    });
  }
  return edges;
}

/**
 * Nested group edges (parent container → nested member group).
 * Merge LDAP `member` (when present) with child.`memberOf` — sync often omits
 * full member dumps, and a user-only member list must not skip parent links.
 */
export function buildNestedMemberEdgesForGroup(
  tenantId,
  applicationId,
  entitlementDoc,
  dnToGroupNodeId,
) {
  const raw =
    entitlementDoc?.rawData && typeof entitlementDoc.rawData === "object"
      ? entitlementDoc.rawData
      : {};
  const selfDn = normalizeDn(
    raw.groupDN || raw.source_dn || raw.distinguishedName || "",
  );
  const groupNodeId =
    (selfDn && dnToGroupNodeId.get(selfDn)) ||
    resolveGroupNodeFromEntitlement(tenantId, applicationId, entitlementDoc);
  if (!groupNodeId) return [];

  const edges = [];
  const seen = new Set();
  const pushEdge = (sourceNodeId, targetNodeId, metadata) => {
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
    const key = `${sourceNodeId}|${targetNodeId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      tenantId,
      applicationId,
      sourceNodeId,
      sourceType: GRAPH_NODE_TYPES.GROUP,
      targetNodeId,
      targetType: GRAPH_NODE_TYPES.GROUP,
      relationshipType: GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
      metadata,
    });
  };

  for (const memberDn of extractGroupMemberDns(entitlementDoc)) {
    const targetNodeId = dnToGroupNodeId.get(normalizeDn(memberDn));
    if (!targetNodeId) continue;
    pushEdge(groupNodeId, targetNodeId, { memberDn });
  }

  for (const parentDn of extractGroupMemberOfDns(entitlementDoc)) {
    const parentNodeId = dnToGroupNodeId.get(normalizeDn(parentDn));
    if (!parentNodeId) continue;
    pushEdge(parentNodeId, groupNodeId, {
      memberOfDn: parentDn,
      derivedFrom: "memberOf",
    });
  }

  return edges;
}

/**
 * Merge NESTED_MEMBER_OF edges derived from entitlement memberOf into an
 * in-memory scan graph (heals stale graphs after sync omitted nesting).
 * Also expands privilegeGroupIds to privileged groups with a direct USER member
 * (test.ps1 / PRIVILEGED_ACCESS analog).
 *
 * @returns {{ nestedEdgesAdded: number, privilegeGroupsAdded: number }}
 */
export function supplementScanGraphNestingFromEntitlements({
  tenantId,
  applicationId,
  scanGraph,
  entitlements,
}) {
  if (!scanGraph || !Array.isArray(entitlements) || !entitlements.length) {
    return { nestedEdgesAdded: 0, privilegeGroupsAdded: 0 };
  }

  const { dnToGroupNodeId, privilegedGroupNodeIds } = buildGroupCatalogIndexes(
    tenantId,
    applicationId,
    entitlements,
  );

  if (!scanGraph.membershipAdj) scanGraph.membershipAdj = new Map();
  if (!scanGraph.nestedGroupAdj) scanGraph.nestedGroupAdj = new Map();
  if (!scanGraph.incomingByTarget) scanGraph.incomingByTarget = new Map();
  if (!scanGraph.privilegeGroupIds) scanGraph.privilegeGroupIds = new Set();

  let nestedEdgesAdded = 0;
  for (const ent of entitlements) {
    for (const edge of buildNestedMemberEdgesForGroup(
      tenantId,
      applicationId,
      ent,
      dnToGroupNodeId,
    )) {
      const fwd = scanGraph.membershipAdj.get(edge.sourceNodeId) || [];
      if (!fwd.includes(edge.targetNodeId)) {
        fwd.push(edge.targetNodeId);
        scanGraph.membershipAdj.set(edge.sourceNodeId, fwd);
        nestedEdgesAdded += 1;
      }
      const nest = scanGraph.nestedGroupAdj.get(edge.sourceNodeId) || [];
      if (!nest.includes(edge.targetNodeId)) {
        nest.push(edge.targetNodeId);
        scanGraph.nestedGroupAdj.set(edge.sourceNodeId, nest);
      }
      const incoming = scanGraph.incomingByTarget.get(edge.targetNodeId) || [];
      if (!incoming.includes(edge.sourceNodeId)) {
        incoming.push(edge.sourceNodeId);
        scanGraph.incomingByTarget.set(edge.targetNodeId, incoming);
      }
    }
  }

  let privilegeGroupsAdded = 0;
  for (const nodeId of privilegedGroupNodeIds) {
    if (scanGraph.privilegeGroupIds.has(nodeId)) continue;
    const incoming = scanGraph.incomingByTarget.get(nodeId) || [];
    const hasDirectUser = incoming.some((id) => String(id).includes(":USER:"));
    if (!hasDirectUser) continue;
    scanGraph.privilegeGroupIds.add(nodeId);
    privilegeGroupsAdded += 1;
  }

  return { nestedEdgesAdded, privilegeGroupsAdded };
}

/**
 * Direct privileged access edge (user → privileged group).
 */
export function buildPrivilegedAccessEdge(
  tenantId,
  applicationId,
  userNodeId,
  groupNodeId,
  metadata = {},
) {
  if (!userNodeId || !groupNodeId) return null;
  return {
    tenantId,
    applicationId,
    sourceNodeId: userNodeId,
    sourceType: GRAPH_NODE_TYPES.USER,
    targetNodeId: groupNodeId,
    targetType: GRAPH_NODE_TYPES.GROUP,
    relationshipType: GRAPH_EDGE_TYPES.PRIVILEGED_ACCESS,
    metadata,
  };
}

/**
 * Index entitlements → group node ids + privileged flags.
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @param {string|import('mongoose').Types.ObjectId} applicationId
 * @param {object[]} entitlements
 */
export function buildGroupCatalogIndexes(tenantId, applicationId, entitlements) {
  const dnToGroupNodeId = new Map();
  const nodeIdToMeta = new Map();
  const privilegedGroupNodeIds = new Set();

  for (const ent of entitlements || []) {
    const raw = ent?.rawData && typeof ent.rawData === "object" ? ent.rawData : {};
    const nodeId = resolveGroupNodeFromEntitlement(tenantId, applicationId, ent);
    if (!nodeId) continue;

    const dn = normalizeDn(raw.groupDN || raw.distinguishedName);
    if (dn) dnToGroupNodeId.set(dn, nodeId);

    const sid = String(raw.objectSid || ent.objectSid || "").trim();
    if (sid) {
      dnToGroupNodeId.set(`sid:${sid.toLowerCase()}`, nodeId);
    }

    const eid = String(ent.entitlement_id || "").trim().toLowerCase();
    if (eid) dnToGroupNodeId.set(`eid:${eid}`, nodeId);

    nodeIdToMeta.set(nodeId, {
      entitlementId: ent.entitlement_id,
      name: ent.entitlement_name,
      dn: raw.groupDN,
      isPrivileged: isPrivilegedEntitlement(ent),
    });

    if (isPrivilegedEntitlement(ent)) {
      privilegedGroupNodeIds.add(nodeId);
    }
  }

  return { dnToGroupNodeId, nodeIdToMeta, privilegedGroupNodeIds };
}

/**
 * Register member DN that is itself a group (nested).
 * @param {string} memberDn
 * @param {Map<string, string>} dnToGroupNodeId
 */
export function resolveMemberDnToGroupNodeId(memberDn, dnToGroupNodeId) {
  const norm = normalizeDn(memberDn);
  if (!norm) return "";
  if (dnToGroupNodeId.has(norm)) return dnToGroupNodeId.get(norm);
  const cn = norm.split(",")[0] || "";
  return dnToGroupNodeId.get(cn) || "";
}

export function resolveGroupNodeIdFromMemberDn(
  tenantId,
  applicationId,
  memberDn,
  dnToGroupNodeId,
) {
  const hit = resolveMemberDnToGroupNodeId(memberDn, dnToGroupNodeId);
  if (hit) return hit;
  return resolveGroupNodeId({
    tenantId,
    applicationId,
    groupDN: memberDn,
  });
}
