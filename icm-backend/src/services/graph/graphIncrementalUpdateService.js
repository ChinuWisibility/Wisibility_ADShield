import IdentityGraphEdge from "../../models/security/IdentityGraphEdge.js";
import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { toTenantObjectId } from "../../utils/applicationDynamicCollections.js";
import { normalizeDn } from "../ad/ldapNormalizer.js";
import { GRAPH_EDGE_TYPES, GRAPH_NODE_TYPES } from "./graphConstants.js";
import {
  buildGroupCatalogIndexes,
  buildMemberOfEdgesForUser,
  buildNestedMemberEdgesForGroup,
  buildPrivilegedAccessEdge,
  resolveGroupNodeIdFromMemberDn,
} from "./graphEdgeBuilder.js";
import { resolveGroupNodeFromEntitlement, resolveUserNodeFromDoc } from "./graphNodeResolver.js";
import {
  ADJACENCY_CACHE_KEYS,
  buildReverseAdjacency,
  invalidateAdjacencyCache,
  persistAdjacencyCache,
} from "./graphAdjacencyCacheService.js";
import { updateGraphMetadata } from "./graphMetadataService.js";
import { createGraphMetrics, finalizeMetrics, msSince } from "./graphObservability.js";
import { isIncrementalGraphUpdatesEnabled } from "./graphIncrementalFlags.js";

const EDGE_UPSERT_CHUNK = 2000;
const EDGE_DELETE_CHUNK = 2000;
const YIELD_EVERY = 500;

export function edgeIdentityKey(edge) {
  return `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.relationshipType}`;
}

/**
 * Pure plan: which edge keys to delete / insert given desired vs existing sets.
 * Unchanged = in both sets (must not touch Mongo when incremental).
 * @param {Map<string, unknown>|Set<string>} desiredKeys
 * @param {Iterable<string>} existingKeys
 */
export function computeEdgeMutationPlan(desiredKeys, existingKeys) {
  const existingSet = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const desiredIsMap = desiredKeys instanceof Map;
  const desiredSet = desiredIsMap ? null : desiredKeys instanceof Set ? desiredKeys : new Set(desiredKeys);

  const desiredHas = (key) => (desiredIsMap ? desiredKeys.has(key) : desiredSet.has(key));
  const desiredCount = desiredIsMap ? desiredKeys.size : desiredSet.size;

  const toDeleteKeys = [];
  for (const key of existingSet) {
    if (!desiredHas(key)) toDeleteKeys.push(key);
  }

  const toInsertKeys = [];
  const desiredIter = desiredIsMap ? desiredKeys.keys() : desiredSet.values();
  for (const key of desiredIter) {
    if (!existingSet.has(key)) toInsertKeys.push(key);
  }

  const unchanged = Math.max(0, desiredCount - toInsertKeys.length);

  return {
    toDeleteKeys,
    toInsertKeys,
    unchanged,
    desiredCount,
    existingCount: existingSet.size,
  };
}

export function parseEdgeIdentityKey(key) {
  const parts = String(key || "").split("|");
  if (parts.length < 3) {
    return { sourceNodeId: parts[0] || "", targetNodeId: parts[1] || "", relationshipType: parts[2] || "" };
  }
  const relationshipType = parts[parts.length - 1];
  const targetNodeId = parts[parts.length - 2];
  const sourceNodeId = parts.slice(0, parts.length - 2).join("|");
  return { sourceNodeId, targetNodeId, relationshipType };
}

function coerceDnList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value != null && String(value).trim()) return [String(value).trim()];
  return [];
}

function groupToEntitlementDoc(group) {
  const fromRaw = group?._raw && typeof group._raw === "object" ? group._raw : {};
  const members = coerceDnList(group.members?.length ? group.members : fromRaw.members);
  const memberOf = coerceDnList(
    group.memberOf?.length ? group.memberOf : fromRaw.memberOf ?? fromRaw.member_of,
  );
  return {
    entitlement_id: group.objectSid || group.groupDN || group.groupName,
    entitlement_name: group.groupName || group.groupDN,
    entitlement_type: "AD_GROUP",
    rawData: {
      groupDN: group.groupDN,
      objectSid: group.objectSid,
      // Fast sync omits LDAP `member`; nest via child.memberOf (parent → child).
      members,
      memberOf,
    },
  };
}

async function yieldToEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * Bulk upsert graph edges (unordered, batched).
 */
export async function bulkUpsertGraphEdges(edges, metrics) {
  let upserted = 0;
  for (let i = 0; i < edges.length; i += EDGE_UPSERT_CHUNK) {
    const chunk = edges.slice(i, i + EDGE_UPSERT_CHUNK);
    if (!chunk.length) continue;
    await IdentityGraphEdge.bulkWrite(
      chunk.map((doc) => ({
        updateOne: {
          filter: {
            tenantId: doc.tenantId,
            applicationId: doc.applicationId,
            sourceNodeId: doc.sourceNodeId,
            targetNodeId: doc.targetNodeId,
            relationshipType: doc.relationshipType,
          },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    upserted += chunk.length;
    if (metrics) metrics.edgeUpserts += chunk.length;
    if (i > 0 && i % (EDGE_UPSERT_CHUNK * 2) === 0) await yieldToEventLoop();
  }
  return upserted;
}

/**
 * Delete stale edges by compound key (batched deleteOne ops).
 */
export async function bulkDeleteGraphEdges(tenantId, applicationId, edgesToDelete, metrics) {
  let deleted = 0;
  for (let i = 0; i < edgesToDelete.length; i += EDGE_DELETE_CHUNK) {
    const chunk = edgesToDelete.slice(i, i + EDGE_DELETE_CHUNK);
    if (!chunk.length) continue;
    await IdentityGraphEdge.bulkWrite(
      chunk.map((e) => ({
        deleteOne: {
          filter: {
            tenantId,
            applicationId,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            relationshipType: e.relationshipType,
          },
        },
      })),
      { ordered: false },
    );
    deleted += chunk.length;
    if (metrics) metrics.edgeDeletes += chunk.length;
  }
  return deleted;
}

/**
 * Load existing edge keys for an application (cursor, lean).
 */
export async function loadExistingEdgeKeys(tenantId, applicationId) {
  const keys = new Set();
  const cursor = IdentityGraphEdge.find({ tenantId, applicationId })
    .select("sourceNodeId targetNodeId relationshipType")
    .lean()
    .cursor();

  let n = 0;
  for await (const edge of cursor) {
    keys.add(edgeIdentityKey(edge));
    n += 1;
    if (n % YIELD_EVERY === 0) await yieldToEventLoop();
  }
  return keys;
}

/**
 * Diff desired vs existing edges; apply deletes + upserts.
 *
 * When ENABLE_INCREMENTAL_GRAPH_UPDATES is on (default): only insert edges that
 * do not already exist; unchanged edges are not written. Deletes still remove
 * memberships that disappeared. End-state edge identity set matches full rewrite.
 *
 * When flag is off: legacy behavior upserts every desired edge (rewrite).
 */
export async function applyEdgeDiff({
  tenantId,
  applicationId,
  desiredEdges,
  metrics,
  fullReplace = false,
  incremental = isIncrementalGraphUpdatesEnabled(),
}) {
  const detailTimings = {};
  // fullReplace forces legacy upsert-all path (complete rewrite of desired set).
  const useIncremental = incremental && !fullReplace;

  const tMap = Date.now();
  const desiredMap = new Map();
  for (const edge of desiredEdges) {
    desiredMap.set(edgeIdentityKey(edge), edge);
  }
  detailTimings.graph_desired_map_build_ms = Date.now() - tMap;
  detailTimings.graph_desired_edge_count = desiredMap.size;

  const tLoad = Date.now();
  const existingKeys = await loadExistingEdgeKeys(tenantId, applicationId);
  detailTimings.graph_existing_edge_load_ms = Date.now() - tLoad;
  detailTimings.graph_existing_edge_count = existingKeys.size;
  detailTimings.mongoReads = (detailTimings.mongoReads || 0) + 1;

  const tDiff = Date.now();
  const plan = computeEdgeMutationPlan(desiredMap, existingKeys);
  const toDelete = plan.toDeleteKeys.map(parseEdgeIdentityKey);
  detailTimings.graph_stale_key_compute_ms = Date.now() - tDiff;
  detailTimings.graph_edges_unchanged = plan.unchanged;
  detailTimings.graph_edges_to_insert = plan.toInsertKeys.length;
  detailTimings.graph_edges_to_delete = plan.toDeleteKeys.length;
  detailTimings.graph_incremental = useIncremental;

  const tDel = Date.now();
  const deleted = await bulkDeleteGraphEdges(tenantId, applicationId, toDelete, metrics);
  detailTimings.graph_edge_delete_ms = Date.now() - tDel;
  detailTimings.graph_edge_delete_count = deleted;
  detailTimings.mongoWrites = (detailTimings.mongoWrites || 0) + deleted;

  const tUp = Date.now();
  let upserted = 0;
  let edgesUpdated = 0;
  if (useIncremental) {
    const toInsertEdges = plan.toInsertKeys.map((key) => desiredMap.get(key)).filter(Boolean);
    upserted = await bulkUpsertGraphEdges(toInsertEdges, metrics);
    detailTimings.graph_edge_insert_count = upserted;
    detailTimings.graph_edge_update_count = 0;
  } else {
    upserted = await bulkUpsertGraphEdges([...desiredMap.values()], metrics);
    edgesUpdated = plan.unchanged;
    detailTimings.graph_edge_insert_count = plan.toInsertKeys.length;
    detailTimings.graph_edge_update_count = edgesUpdated;
  }
  detailTimings.graph_edge_upsert_ms = Date.now() - tUp;
  detailTimings.graph_edge_upsert_count = upserted;
  detailTimings.mongoWrites = (detailTimings.mongoWrites || 0) + upserted;

  return {
    upserted,
    deleted,
    inserted: useIncremental ? upserted : plan.toInsertKeys.length,
    updated: useIncremental ? 0 : edgesUpdated,
    unchanged: plan.unchanged,
    edgeCount: desiredMap.size,
    existingEdgeCount: existingKeys.size,
    incremental: useIncremental,
    detailTimings,
    mongoReads: 1,
    mongoWrites: deleted + upserted,
  };
}

/**
 * Build all desired edges from LDAP directory payload (sync-time, no Mongo rescan).
 */
export function buildEdgesFromDirectoryPayload({
  tenantId,
  applicationId,
  userDocs,
  groups,
  privilegedGroupNodeIds,
  dnToGroupNodeId,
}) {
  const edges = [];
  const userNodeIds = new Set();
  const groupNodeIds = new Set();

  for (const group of groups || []) {
    const ent = groupToEntitlementDoc(group);
    const dn = normalizeDn(group.groupDN);
    if (dn && !dnToGroupNodeId.has(dn)) {
      const nodeId = resolveGroupNodeIdFromMemberDn(
        tenantId,
        applicationId,
        dn,
        dnToGroupNodeId,
      );
      if (nodeId) dnToGroupNodeId.set(dn, nodeId);
    }
    for (const edge of buildNestedMemberEdgesForGroup(
      tenantId,
      applicationId,
      ent,
      dnToGroupNodeId,
    )) {
      edges.push(edge);
      groupNodeIds.add(edge.sourceNodeId);
    }
  }

  for (const user of userDocs || []) {
    const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
    if (userNodeId) userNodeIds.add(userNodeId);

    for (const edge of buildMemberOfEdgesForUser(
      tenantId,
      applicationId,
      user,
      dnToGroupNodeId,
    )) {
      edges.push(edge);
      if (privilegedGroupNodeIds.has(edge.targetNodeId)) {
        const pEdge = buildPrivilegedAccessEdge(
          tenantId,
          applicationId,
          userNodeId,
          edge.targetNodeId,
          { direct: true },
        );
        if (pEdge) edges.push(pEdge);
      }
    }
  }

  return { edges, userNodeIds, groupNodeIds };
}

/**
 * Build desired edges by scanning persisted Mongo users/entitlements (fallback path).
 */
export async function buildEdgesFromPersistedData(application) {
  const tenantId = toTenantObjectId(application.tenantId);
  const applicationId = application._id;

  const EntitlementModel = await getDynamicEntitlementModelForTenantId(
    application.name,
    application.tenantId,
  );
  const UserModel = await getDynamicUserModelForTenantId(
    application.name,
    application.tenantId,
  );

  const entitlements = [];
  const entCursor = EntitlementModel.find({ applicationId })
    .select(
      "entitlement_id entitlement_name entitlement_type rawData is_privilege isPrivileged classification",
    )
    .lean()
    .cursor();

  for await (const row of entCursor) {
    entitlements.push(row);
    if (entitlements.length >= 100_000) break;
  }

  const { dnToGroupNodeId, privilegedGroupNodeIds } = buildGroupCatalogIndexes(
    tenantId,
    applicationId,
    entitlements,
  );

  for (const ent of entitlements) {
    const raw = ent?.rawData || {};
    const dn = normalizeDn(raw.groupDN || raw.source_dn);
    if (dn && !dnToGroupNodeId.has(dn)) {
      const nodeId = resolveGroupNodeIdFromMemberDn(
        tenantId,
        applicationId,
        dn,
        dnToGroupNodeId,
      );
      if (nodeId) dnToGroupNodeId.set(dn, nodeId);
    }
  }

  const edges = [];
  const userNodeIds = new Set();
  const groupNodeIds = new Set();

  for (const ent of entitlements) {
    for (const edge of buildNestedMemberEdgesForGroup(
      tenantId,
      applicationId,
      ent,
      dnToGroupNodeId,
    )) {
      edges.push(edge);
      groupNodeIds.add(edge.sourceNodeId);
    }
  }

  const userCursor = UserModel.find({ applicationId })
    .select("user_id email member_of_entitlements rawData status")
    .lean()
    .cursor();

  let userCount = 0;
  for await (const user of userCursor) {
    userCount += 1;
    const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
    if (userNodeId) userNodeIds.add(userNodeId);

    for (const edge of buildMemberOfEdgesForUser(
      tenantId,
      applicationId,
      user,
      dnToGroupNodeId,
    )) {
      edges.push(edge);
      if (privilegedGroupNodeIds.has(edge.targetNodeId)) {
        const pEdge = buildPrivilegedAccessEdge(
          tenantId,
          applicationId,
          userNodeId,
          edge.targetNodeId,
          { direct: true },
        );
        if (pEdge) edges.push(pEdge);
      }
    }
    if (userCount % YIELD_EVERY === 0) await yieldToEventLoop();
  }

  return {
    edges,
    userNodeIds,
    groupNodeIds,
    entitlementsScanned: entitlements.length,
    privilegedGroupNodeIds,
    dnToGroupNodeId,
  };
}

function countEdgesByType(edges) {
  const counts = {
    [GRAPH_EDGE_TYPES.MEMBER_OF]: 0,
    [GRAPH_EDGE_TYPES.NESTED_MEMBER_OF]: 0,
    [GRAPH_EDGE_TYPES.PRIVILEGED_ACCESS]: 0,
  };
  for (const e of edges) {
    counts[e.relationshipType] = (counts[e.relationshipType] || 0) + 1;
  }
  return counts;
}

async function refreshAdjacencyCaches({
  tenantId,
  applicationId,
  graphVersion,
  edges,
  metrics,
}) {
  const forward = new Map();
  const nested = new Map();
  const userDirect = new Map();

  for (const edge of edges) {
    if (edge.relationshipType === GRAPH_EDGE_TYPES.NESTED_MEMBER_OF) {
      const list = nested.get(edge.sourceNodeId) || [];
      list.push(edge.targetNodeId);
      nested.set(edge.sourceNodeId, list);
    }
    if (
      edge.relationshipType === GRAPH_EDGE_TYPES.MEMBER_OF ||
      edge.relationshipType === GRAPH_EDGE_TYPES.NESTED_MEMBER_OF ||
      edge.relationshipType === GRAPH_EDGE_TYPES.PRIVILEGED_ACCESS
    ) {
      const list = forward.get(edge.sourceNodeId) || [];
      list.push(edge.targetNodeId);
      forward.set(edge.sourceNodeId, list);
    }
    if (edge.relationshipType === GRAPH_EDGE_TYPES.MEMBER_OF) {
      const list = userDirect.get(edge.sourceNodeId) || [];
      list.push(edge.targetNodeId);
      userDirect.set(edge.sourceNodeId, list);
    }
  }

  const incoming = buildReverseAdjacency(forward);

  await persistAdjacencyCache({
    tenantId,
    applicationId,
    cacheKey: ADJACENCY_CACHE_KEYS.INCOMING_BY_TARGET,
    graphVersion,
    adjacencyMap: incoming,
    metrics,
  });
  await persistAdjacencyCache({
    tenantId,
    applicationId,
    cacheKey: ADJACENCY_CACHE_KEYS.NESTED_GROUP_ADJ,
    graphVersion,
    adjacencyMap: nested,
    metrics,
  });
  await persistAdjacencyCache({
    tenantId,
    applicationId,
    cacheKey: ADJACENCY_CACHE_KEYS.USER_DIRECT_GROUPS,
    graphVersion,
    adjacencyMap: userDirect,
    metrics,
  });
}

/**
 * Incremental graph update from AD sync directory payload (primary path).
 * detailTimings / spans are observation-only (Iteration 0).
 */
export async function incrementalGraphUpdateFromDirectory(
  application,
  { directory, canonicalUserDocs, groups, source = "ad_sync", detailTracker } = {},
) {
  const tenantId = toTenantObjectId(application.tenantId);
  const applicationId = application._id;
  const scopeKey = `${tenantId}:${applicationId}`;
  const metrics = createGraphMetrics(scopeKey);
  const t0 = Date.now();
  const detailTimings = {};
  const track = detailTracker;

  const userDocs = canonicalUserDocs || directory?.userDocs || [];
  const groupList = groups || directory?.groups || [];

  const run = async (name, fn, meta) => {
    if (track?.span) return track.span(name, fn, { parent: "graph", ...(meta || {}) });
    const t = Date.now();
    const result = await fn({ documentsProcessed: 0, mongoReads: 0, mongoWrites: 0 });
    detailTimings[`${name}_ms`] = Date.now() - t;
    return result;
  };

  const EntitlementModel = await getDynamicEntitlementModelForTenantId(
    application.name,
    application.tenantId,
  );

  const entitlements = await run(
    "graph_entitlement_catalog_load",
    async (c) => {
      const rows = await EntitlementModel.find({ applicationId })
        .select(
          "entitlement_id entitlement_name entitlement_type rawData is_privilege isPrivileged classification",
        )
        .lean();
      c.mongoReads = 1;
      c.documentsProcessed = rows.length;
      return rows;
    },
  );

  const { dnToGroupNodeId, privilegedGroupNodeIds } = await run(
    "graph_catalog_index_build",
    async (c) => {
      const catalogGroups = groupList.map(groupToEntitlementDoc);
      const idx = buildGroupCatalogIndexes(tenantId, applicationId, [
        ...entitlements,
        ...catalogGroups,
      ]);
      c.documentsProcessed = entitlements.length + catalogGroups.length;
      return idx;
    },
  );

  const { edges, userNodeIds, groupNodeIds } = await run(
    "graph_desired_edge_construction",
    async (c) => {
      const built = buildEdgesFromDirectoryPayload({
        tenantId,
        applicationId,
        userDocs,
        groups: groupList,
        privilegedGroupNodeIds,
        dnToGroupNodeId,
      });
      c.documentsProcessed = built.edges.length;
      return built;
    },
  );

  // Sub-stages of applyEdgeDiff — call internals via applyEdgeDiff which returns detailTimings.
  // Also emit exclusive spans from those timings when tracker present.
  const diff = await run(
    "graph_edge_diff_apply",
    async (c) => {
      const result = await applyEdgeDiff({
        tenantId,
        applicationId,
        desiredEdges: edges,
        metrics,
        fullReplace: false,
      });
      c.mongoReads = result.mongoReads || 0;
      c.mongoWrites = result.mongoWrites || 0;
      c.documentsProcessed = result.edgeCount || 0;
      return result;
    },
    { exclusive: false },
  );

  if (diff.detailTimings && track?.recordSync) {
    const dt = diff.detailTimings;
    track.recordSync("graph_desired_map_build", dt.graph_desired_map_build_ms || 0, {
      parent: "graph_edge_diff_apply",
      documentsProcessed: edges.length,
    });
    track.recordSync("graph_existing_edge_load", dt.graph_existing_edge_load_ms || 0, {
      parent: "graph_edge_diff_apply",
      documentsProcessed: dt.graph_existing_edge_count || 0,
      mongoReads: 1,
    });
    track.recordSync("graph_stale_key_compute", dt.graph_stale_key_compute_ms || 0, {
      parent: "graph_edge_diff_apply",
      documentsProcessed: dt.graph_edge_delete_count || 0,
    });
    track.recordSync("graph_edge_delete", dt.graph_edge_delete_ms || 0, {
      parent: "graph_edge_diff_apply",
      documentsProcessed: dt.graph_edge_delete_count || 0,
      mongoWrites: dt.graph_edge_delete_count || 0,
    });
    track.recordSync("graph_edge_upsert", dt.graph_edge_upsert_ms || 0, {
      parent: "graph_edge_diff_apply",
      documentsProcessed: dt.graph_edge_upsert_count || 0,
      mongoWrites: dt.graph_edge_upsert_count || 0,
      extra: {
        incremental: dt.graph_incremental,
        unchanged: dt.graph_edges_unchanged,
        inserted: dt.graph_edge_insert_count,
        updated: dt.graph_edge_update_count,
      },
    });
    if (typeof dt.graph_edges_unchanged === "number") {
      track.recordSync("graph_edges_unchanged", 0, {
        parent: "graph_edge_diff_apply",
        documentsProcessed: dt.graph_edges_unchanged,
        exclusive: true,
        extra: { note: "count-only; no Mongo writes" },
      });
    }
    Object.assign(detailTimings, dt);
  }

  metrics.edgeBuildMs = msSince(t0);
  metrics.nodeCounts = {
    users: userNodeIds.size,
    groups: groupNodeIds.size,
  };
  metrics.edgeCounts = countEdgesByType(edges);

  const meta = await run(
    "graph_metadata_update",
    async (c) => {
      const m = await updateGraphMetadata(tenantId, applicationId, {
        edgeCount: diff.edgeCount,
        nodeCounts: metrics.nodeCounts,
        edgeCountsByType: metrics.edgeCounts,
        privilegedGroupCount: privilegedGroupNodeIds.size,
        lastIncrementalUpdateAt: new Date(),
        updateSource: source,
        timings: finalizeMetrics(metrics),
        incrementalStats: {
          incremental: Boolean(diff.incremental),
          unchanged: diff.unchanged || 0,
          inserted: diff.inserted || 0,
          updated: diff.updated || 0,
          deleted: diff.deleted || 0,
          existingEdgeCount: diff.existingEdgeCount || 0,
        },
      });
      c.mongoWrites = 1;
      return m;
    },
  );

  const edgeMutations = (diff.deleted || 0) + (diff.upserted || 0);
  await run(
    "graph_adjacency_cache_rebuild",
    async (c) => {
      if (diff.incremental && edgeMutations === 0) {
        c.documentsProcessed = 0;
        c.mongoWrites = 0;
        detailTimings.graph_adjacency_cache_skipped = true;
        return;
      }
      await refreshAdjacencyCaches({
        tenantId,
        applicationId,
        graphVersion: meta.graphVersion,
        edges,
        metrics,
      });
      c.documentsProcessed = edges.length;
      c.mongoWrites = 3;
    },
  );

  return {
    mode: "incremental_directory",
    incremental: Boolean(diff.incremental),
    edgeCount: diff.edgeCount,
    upserted: diff.upserted,
    deleted: diff.deleted,
    inserted: diff.inserted,
    updated: diff.updated,
    unchanged: diff.unchanged,
    existingEdgeCount: diff.existingEdgeCount,
    groupNodes: groupNodeIds.size,
    privilegedGroups: privilegedGroupNodeIds.size,
    usersProcessed: userNodeIds.size,
    groupsProcessed: groupList.length,
    graphVersion: meta.graphVersion,
    timings: metrics,
    detailTimings,
    mongoReads: (diff.mongoReads || 0) + 1,
    mongoWrites:
      (diff.mongoWrites || 0) +
      1 +
      (diff.incremental && edgeMutations === 0 ? 0 : 3),
  };
}

/**
 * Incremental graph update from persisted Mongo data (fallback / backfill).
 */
export async function incrementalGraphUpdateFromDb(application, options = {}) {
  const tenantId = toTenantObjectId(application.tenantId);
  const applicationId = application._id;
  const scopeKey = `${tenantId}:${applicationId}`;
  const metrics = createGraphMetrics(scopeKey);
  const t0 = Date.now();

  if (options.fullRebuild) {
    await IdentityGraphEdge.deleteMany({ tenantId, applicationId });
    await invalidateAdjacencyCache({ tenantId, applicationId, metrics });
  }

  const built = await buildEdgesFromPersistedData(application);
  const diff = await applyEdgeDiff({
    tenantId,
    applicationId,
    desiredEdges: built.edges,
    metrics,
    fullReplace: false,
  });

  metrics.edgeBuildMs = msSince(t0);
  metrics.nodeCounts = {
    users: built.userNodeIds.size,
    groups: built.groupNodeIds.size,
  };
  metrics.edgeCounts = countEdgesByType(built.edges);

  const meta = await updateGraphMetadata(tenantId, applicationId, {
    edgeCount: diff.edgeCount,
    nodeCounts: metrics.nodeCounts,
    edgeCountsByType: metrics.edgeCounts,
    privilegedGroupCount: built.privilegedGroupNodeIds.size,
    lastIncrementalUpdateAt: new Date(),
    lastMaterializedAt: new Date(),
    updateSource: options.source || "db_incremental",
    timings: finalizeMetrics(metrics),
  });

  await refreshAdjacencyCaches({
    tenantId,
    applicationId,
    graphVersion: meta.graphVersion,
    edges: built.edges,
    metrics,
  });

  return {
    mode: options.fullRebuild ? "full_rebuild" : "incremental_db",
    edgeCount: diff.edgeCount,
    upserted: diff.upserted,
    deleted: diff.deleted,
    groupNodes: built.groupNodeIds.size,
    privilegedGroups: built.privilegedGroupNodeIds.size,
    entitlementsScanned: built.entitlementsScanned,
    graphVersion: meta.graphVersion,
    timings: metrics,
  };
}

/**
 * Fire-and-forget wrapper for AD sync pipeline (non-blocking).
 */
export function scheduleIncrementalGraphUpdate(application, payload = {}) {
  setImmediate(async () => {
    try {
      const result = await incrementalGraphUpdateFromDirectory(application, payload);
      console.info(
        `[graph] incremental update complete app=${application.name} edges=${result.edgeCount} mode=${result.mode}`,
      );
    } catch (err) {
      console.error(
        `[graph] incremental update failed app=${application?.name}:`,
        err?.message || err,
      );
    }
  });
}
