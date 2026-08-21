import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { GRAPH_EDGE_TYPES, TOXIC_PRIVILEGE_MIN_GROUPS } from "./graphConstants.js";
import {
  ADJACENCY_CACHE_KEYS,
  loadAdjacencyCache,
} from "./graphAdjacencyCacheService.js";
import { getGraphMetadata } from "./graphMetadataService.js";
import {
  createGraphMetrics,
  incrementMetric,
  msSince,
  snapshotMemory,
} from "./graphObservability.js";
import {
  detectCyclesInAdjacency,
} from "./graphTraversalEngine.js";
import { buildGraphRiskFinding } from "./graphFindingBuilder.js";
import {
  resolveGroupNodeFromEntitlement,
  resolveUserNodeFromDoc,
} from "./graphNodeResolver.js";
import { normalizeDn } from "../ldapNormalizer.js";
import { supplementScanGraphNestingFromEntitlements } from "./graphEdgeBuilder.js";

const YIELD_EVERY = 500;

async function yieldToEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

function computeNestedDepthsMemo(nestedAdj) {
  const depthCache = new Map();
  const visiting = new Set();

  function depth(nodeId) {
    if (depthCache.has(nodeId)) return depthCache.get(nodeId);
    if (visiting.has(nodeId)) return Infinity;
    visiting.add(nodeId);
    const children = nestedAdj.get(nodeId) || [];
    let maxChild = 0;
    for (const c of children) {
      maxChild = Math.max(maxChild, depth(c));
    }
    visiting.delete(nodeId);
    const d = children.length ? 1 + maxChild : 0;
    depthCache.set(nodeId, d);
    return d;
  }

  for (const nodeId of nestedAdj.keys()) depth(nodeId);
  return depthCache;
}

/**
 * Shared graph analysis context — single preload + memoized traversals.
 */
export async function buildGraphAnalysisContext({
  tenantId,
  applicationId,
  application,
  scanId,
  scanGraph,
  metrics: parentMetrics,
}) {
  const t0 = Date.now();
  const metrics = parentMetrics || createGraphMetrics(`${tenantId}:${applicationId}:analyze`);

  const meta = await getGraphMetadata(tenantId, applicationId);
  const graphVersion = meta?.graphVersion || 0;

  let incomingByTarget = scanGraph.incomingByTarget;
  if (!incomingByTarget?.size) {
    incomingByTarget =
      (await loadAdjacencyCache({
        tenantId,
        applicationId,
        cacheKey: ADJACENCY_CACHE_KEYS.INCOMING_BY_TARGET,
        graphVersion,
        metrics,
      })) || incomingByTarget;
  }

  let nestedGroupAdj =
    scanGraph.nestedGroupAdj ||
    (await loadAdjacencyCache({
      tenantId,
      applicationId,
      cacheKey: ADJACENCY_CACHE_KEYS.NESTED_GROUP_ADJ,
      graphVersion,
      metrics,
    })) ||
    new Map();

  const UserModel = await getDynamicUserModelForTenantId(
    application.name,
    application.tenantId,
  );
  const EntitlementModel = await getDynamicEntitlementModelForTenantId(
    application.name,
    application.tenantId,
  );

  const users = [];
  let userLoadCount = 0;
  const userCursor = UserModel.find({ applicationId })
    .select("user_id display_name email status rawData member_of_entitlements is_privileged")
    .lean()
    .cursor();
  for await (const user of userCursor) {
    users.push(user);
    userLoadCount += 1;
    if (userLoadCount % YIELD_EVERY === 0) await yieldToEventLoop();
  }

  const entitlements = [];
  let entLoadCount = 0;
  const entCursor = EntitlementModel.find({ applicationId })
    .select(
      "entitlement_id entitlement_name entitlement_description entitlement_type rawData owner",
    )
    .lean()
    .cursor();
  for await (const ent of entCursor) {
    entitlements.push(ent);
    entLoadCount += 1;
    if (entLoadCount % YIELD_EVERY === 0) await yieldToEventLoop();
  }

  const groupMetaByNodeId = new Map();
  const groupNodeIds = [];
  for (const ent of entitlements) {
    const nodeId = resolveGroupNodeFromEntitlement(tenantId, applicationId, ent);
    if (!nodeId) continue;
    groupNodeIds.push(nodeId);
    groupMetaByNodeId.set(nodeId, ent);
  }

  // Heal missing NESTED_MEMBER_OF / privilege markers from entitlement memberOf
  // (stale graphs after sync omitted nesting still detect seed topologies).
  const nestHeal = supplementScanGraphNestingFromEntitlements({
    tenantId,
    applicationId,
    scanGraph,
    entitlements,
  });
  if (nestHeal.nestedEdgesAdded || nestHeal.privilegeGroupsAdded) {
    incomingByTarget = scanGraph.incomingByTarget;
    nestedGroupAdj = scanGraph.nestedGroupAdj || nestedGroupAdj;
  }

  if (!incomingByTarget?.size && groupNodeIds.length) {
    incomingByTarget = new Map();
    for (const nodeId of groupNodeIds) incomingByTarget.set(nodeId, []);
    for (const [source, targets] of scanGraph.membershipAdj.entries()) {
      for (const target of targets) {
        const list = incomingByTarget.get(target) || [];
        list.push(source);
        incomingByTarget.set(target, list);
      }
    }
  }

  const privReachableCache = new Map();
  const shortestPathCache = new Map();

  function privilegedGroupsReachable(userNodeId, maxDepth = 16) {
    if (!userNodeId) return [];
    if (privReachableCache.has(userNodeId)) return privReachableCache.get(userNodeId);
    incrementMetric(metrics, "traversalCount");
    const result = scanGraph.privilegedGroupsReachable(userNodeId, maxDepth);
    privReachableCache.set(userNodeId, result);
    return result;
  }

  function shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth = 12) {
    const cacheKey = `${userNodeId}|${targetGroupId}|${maxDepth}`;
    if (shortestPathCache.has(cacheKey)) return shortestPathCache.get(cacheKey);
    incrementMetric(metrics, "traversalCount");
    const path = scanGraph.shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth);
    shortestPathCache.set(cacheKey, path);
    return path;
  }

  function getIncoming(nodeId) {
    return incomingByTarget?.get(nodeId) || [];
  }

  function analyzeGroupStructure() {
    if (analyzeGroupStructure._cache) return analyzeGroupStructure._cache;

    const nestedFindings = [];
    const cycleFindings = [];

    const depthByNode = computeNestedDepthsMemo(nestedGroupAdj);
    for (const [nodeId, maxDepth] of depthByNode.entries()) {
      if (maxDepth < 2) continue;
      nestedFindings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "nested_groups",
          objectType: "group",
          objectName: nodeId,
          status: `max_depth_${maxDepth}`,
          metadata: { maxDepth, nestedDepth: maxDepth },
          findingSignals: [
            "NESTED_GROUP",
          ],
        }),
      );
    }

    incrementMetric(metrics, "traversalCount");
    const { hasCycle, cycles } = detectCyclesInAdjacency(nestedGroupAdj);
    if (hasCycle) {
      const seen = new Set();
      for (const cycle of cycles) {
        const key = cycle.join(">");
        if (seen.has(key)) continue;
        seen.add(key);
        cycleFindings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "circular_memberships",
            objectType: "group",
            objectName: cycle[0] || "cycle",
            status: "cycle_detected",
            relationships: cycle.map((id, i) => ({
              from: id,
              to: cycle[i + 1] || cycle[0],
              type: GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
            })),
            metadata: { cycleLength: cycle.length },
            findingSignals: ["CIRCULAR_GROUP_MEMBERSHIP"],
          }),
        );
      }
    }

    analyzeGroupStructure._cache = { nestedFindings, cycleFindings };
    return analyzeGroupStructure._cache;
  }
  analyzeGroupStructure._cache = null;

  function analyzeUnusedGroups() {
    const findings = [];
    for (const nodeId of groupNodeIds) {
      const members = getIncoming(nodeId);
      const ent = groupMetaByNodeId.get(nodeId);
      const rawMembers = ent?.rawData?.members || [];
      if (members.length === 0 && (!rawMembers || rawMembers.length === 0)) {
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "unused_groups",
            objectType: "group",
            objectName: ent?.entitlement_name || nodeId,
            dn: ent?.rawData?.groupDN || ent?.rawData?.source_dn || "",
            status: "empty",
            findingSignals: ["UNUSED_GROUP"],
          }),
        );
      }
    }
    return findings;
  }

  function analyzeOrphanGroups(unusedFindings) {
    const connected = scanGraph.memberOfTargets || new Set();
    const findings = [];
    for (const f of unusedFindings) {
      const groupNodeId = resolveGroupNodeFromEntitlement(tenantId, applicationId, {
        entitlement_name: f.objectName,
        rawData: { groupDN: f.dn },
      });
      if (!connected.has(groupNodeId)) {
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "orphan_groups",
            objectType: "group",
            objectName: f.objectName,
            dn: f.dn,
            status: "orphan",
            findingSignals: ["ORPHAN_GROUP"],
          }),
        );
      }
    }
    return findings;
  }

  function memberCountKey(members) {
    return [...(members || [])].map((m) => normalizeDn(m)).sort().join("|");
  }

  function analyzeDuplicateGroups() {
    const bySignature = new Map();
    const findings = [];
    for (const ent of entitlements) {
      const members = ent.rawData?.members || [];
      const sig = memberCountKey(members);
      if (!sig) continue;
      const list = bySignature.get(sig) || [];
      list.push(ent);
      bySignature.set(sig, list);
    }
    for (const [, group] of bySignature) {
      if (group.length < 2) continue;
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "duplicate_groups",
          objectType: "group",
          objectName: group[0].entitlement_name,
          status: "duplicate_membership_signature",
          metadata: {
            duplicateCount: group.length,
            relatedNames: group.map((g) => g.entitlement_name).join(", "),
          },
          findingSignals: ["DUPLICATE_GROUP"],
        }),
      );
    }
    return findings;
  }

  function analyzeToxicPrivilegeCombinations() {
    const findings = [];
    for (const user of users) {
      const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
      if (!userNodeId) continue;
      const privGroups = privilegedGroupsReachable(userNodeId, 16);
      if (privGroups.length < TOXIC_PRIVILEGE_MIN_GROUPS) continue;
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "toxic_privilege_combinations",
          objectType: "user",
          objectName: user.display_name || user.user_id,
          dn: user.rawData?.distinguishedName || "",
          status: `privileged_groups_${privGroups.length}`,
          metadata: { privilegedGroupCount: privGroups.length },
          findingSignals: ["TOXIC_PRIVILEGE_COMBINATION", "PRIVILEGED_USER"],
        }),
      );
    }
    return findings;
  }

  metrics.preloadMs = msSince(t0);
  snapshotMemory(metrics);

  return {
    tenantId,
    applicationId,
    application,
    scanId,
    scanGraph,
    metrics,
    graphVersion,
    users,
    entitlements,
    groupMetaByNodeId,
    groupNodeIds,
    incomingByTarget,
    nestedGroupAdj,
    privilegedGroupsReachable,
    shortestPathToPrivileged,
    getIncoming,
    analyzeGroupStructure,
    analyzeUnusedGroups,
    analyzeOrphanGroups,
    analyzeDuplicateGroups,
    analyzeToxicPrivilegeCombinations,
  };
}

export { YIELD_EVERY, yieldToEventLoop };
