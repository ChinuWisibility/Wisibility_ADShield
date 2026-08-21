import IdentityGraphAdjacencyCache from "../../models/security/IdentityGraphAdjacencyCache.js";
import { GRAPH_EDGE_TYPES } from "./graphConstants.js";

const CACHE_CHUNK_SIZE = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const ADJACENCY_CACHE_KEYS = Object.freeze({
  INCOMING_BY_TARGET: "incoming_by_target",
  NESTED_GROUP_ADJ: "nested_group_adj",
  USER_DIRECT_GROUPS: "user_direct_groups",
});

function chunkEntries(map, chunkSize = CACHE_CHUNK_SIZE) {
  const entries = [...map.entries()];
  const chunks = [];
  for (let i = 0; i < entries.length; i += chunkSize) {
    chunks.push(Object.fromEntries(entries.slice(i, i + chunkSize)));
  }
  return chunks.length ? chunks : [{}];
}

/**
 * Persist adjacency map in chunked Mongo documents (incrementally maintained).
 */
export async function persistAdjacencyCache({
  tenantId,
  applicationId,
  cacheKey,
  graphVersion,
  adjacencyMap,
  metrics,
}) {
  const t0 = Date.now();
  await invalidateAdjacencyCache({ tenantId, applicationId, cacheKey });

  const chunks = chunkEntries(adjacencyMap);
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  const ops = chunks.map((entries, chunkIndex) => ({
    updateOne: {
      filter: { tenantId, applicationId, cacheKey, chunkIndex },
      update: {
        $set: {
          tenantId,
          applicationId,
          cacheKey,
          chunkIndex,
          graphVersion,
          entries,
          entryCount: Object.keys(entries).length,
          expiresAt,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length) {
    await IdentityGraphAdjacencyCache.bulkWrite(ops, { ordered: false });
  }

  if (metrics) {
    metrics.adjacencyCacheMs += Date.now() - t0;
  }
  return { chunks: chunks.length, entryCount: adjacencyMap.size };
}

/**
 * Load persisted adjacency cache; returns null on miss or version mismatch.
 */
export async function loadAdjacencyCache({
  tenantId,
  applicationId,
  cacheKey,
  graphVersion,
  metrics,
}) {
  const t0 = Date.now();
  const rows = await IdentityGraphAdjacencyCache.find({
    tenantId,
    applicationId,
    cacheKey,
    graphVersion,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  })
    .select("entries chunkIndex")
    .sort({ chunkIndex: 1 })
    .lean();

  if (!rows.length) {
    if (metrics) metrics.cacheMisses += 1;
    return null;
  }

  const map = new Map();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row.entries || {})) {
      map.set(k, v);
    }
  }

  if (metrics) {
    metrics.cacheHits += 1;
    metrics.adjacencyCacheMs += Date.now() - t0;
  }
  return map;
}

export async function invalidateAdjacencyCache({
  tenantId,
  applicationId,
  cacheKey,
  affectedNodeIds,
  metrics,
}) {
  const filter = { tenantId, applicationId };
  if (cacheKey) filter.cacheKey = cacheKey;

  if (affectedNodeIds?.length && cacheKey) {
    const rows = await IdentityGraphAdjacencyCache.find(filter)
      .select("entries chunkIndex cacheKey")
      .lean();

    const affected = new Set(affectedNodeIds);
    const ops = [];

    for (const row of rows) {
      const entries = { ...(row.entries || {}) };
      let changed = false;
      for (const nodeId of affected) {
        if (nodeId in entries) {
          delete entries[nodeId];
          changed = true;
        }
      }
      if (changed) {
        ops.push({
          updateOne: {
            filter: {
              tenantId,
              applicationId,
              cacheKey: row.cacheKey,
              chunkIndex: row.chunkIndex,
            },
            update: {
              $set: {
                entries,
                entryCount: Object.keys(entries).length,
              },
            },
          },
        });
      }
    }

    if (ops.length) {
      await IdentityGraphAdjacencyCache.bulkWrite(ops, { ordered: false });
    }
    if (metrics) metrics.invalidationCount += affectedNodeIds.length;
    return { mode: "partial", affected: affectedNodeIds.length };
  }

  const res = await IdentityGraphAdjacencyCache.deleteMany(filter);
  if (metrics) metrics.invalidationCount += res.deletedCount || 0;
  return { mode: "full", deleted: res.deletedCount || 0 };
}

/**
 * Build reverse adjacency (target → sources) from forward adjacency.
 */
export function buildReverseAdjacency(forwardAdj) {
  const reverse = new Map();
  for (const [source, targets] of forwardAdj.entries()) {
    for (const target of targets) {
      const list = reverse.get(target) || [];
      list.push(source);
      reverse.set(target, list);
    }
  }
  return reverse;
}

/**
 * Extract nested group-only adjacency from mixed edge types.
 */
export function buildNestedGroupAdjacencyFromScan(scanGraph) {
  if (scanGraph.nestedGroupAdj) return scanGraph.nestedGroupAdj;

  const nested = new Map();
  const memberOfTargets = scanGraph.memberOfTargets || new Set();

  for (const [source, targets] of scanGraph.membershipAdj.entries()) {
    if (!String(source).includes(":GROUP:")) continue;
    const nestedTargets = targets.filter((t) => String(t).includes(":GROUP:"));
    if (nestedTargets.length) nested.set(source, nestedTargets);
  }
  return { nested, memberOfTargets };
}

export { CACHE_CHUNK_SIZE, GRAPH_EDGE_TYPES };
