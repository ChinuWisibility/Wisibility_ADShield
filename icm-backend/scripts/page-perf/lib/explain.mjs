/**
 * Rich Mongo explain extraction for Layer 1.
 */

function walkStages(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (node.inputStage) walkStages(node.inputStage, visit);
  if (Array.isArray(node.inputStages)) node.inputStages.forEach((s) => walkStages(s, visit));
  if (node.shards) {
    for (const shard of node.shards) {
      walkStages(shard.winningPlan || shard.executionStages, visit);
    }
  }
}

export function summarizeExplain(plan) {
  if (!plan) return null;
  const stats = plan.executionStats || {};
  const winning = plan.queryPlanner?.winningPlan || plan.stages?.[0]?.$cursor?.queryPlanner?.winningPlan;
  const execRoot = stats.executionStages || plan.stages?.[0]?.$cursor?.executionStats?.executionStages;
  const indexNames = new Set();
  let hasBlockingSort = false;
  let hasCollectionScan = false;

  walkStages(winning, (stage) => {
    if (stage.indexName) indexNames.add(stage.indexName);
    if (stage.stage === "SORT") hasBlockingSort = true;
    if (stage.stage === "COLLSCAN") hasCollectionScan = true;
  });
  walkStages(execRoot, (stage) => {
    if (stage.indexName) indexNames.add(stage.indexName);
    if (stage.stage === "SORT" || stage.stage === "SORT_KEY_GENERATOR") hasBlockingSort = true;
    if (stage.stage === "COLLSCAN") hasCollectionScan = true;
  });

  // Aggregation explain shape
  const aggStats = plan.stages?.[0]?.$cursor?.executionStats || null;
  const docsExamined = stats.totalDocsExamined ?? aggStats?.totalDocsExamined ?? null;
  const keysExamined = stats.totalKeysExamined ?? aggStats?.totalKeysExamined ?? null;
  const nReturned = stats.nReturned ?? aggStats?.nReturned ?? null;
  const execMs = stats.executionTimeMillis ?? aggStats?.executionTimeMillis ?? null;

  return {
    docsExamined,
    keysExamined,
    nReturned,
    execMs,
    indexNames: [...indexNames],
    indexName: [...indexNames][0] || null,
    hasBlockingSort,
    hasCollectionScan,
    rejectedPlans: plan.queryPlanner?.rejectedPlans?.length ?? 0,
  };
}

export async function explainFind(coll, filter, opts = {}) {
  try {
    const cursor = coll.find(filter, opts);
    const plan = await cursor.explain("executionStats");
    return summarizeExplain(plan);
  } catch {
    return null;
  }
}

export async function explainAggregate(coll, pipeline) {
  try {
    const plan = await coll.aggregate(pipeline).explain("executionStats");
    return summarizeExplain(plan);
  } catch {
    return null;
  }
}
