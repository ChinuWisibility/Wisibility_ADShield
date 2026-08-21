/**
 * @typedef {object} ReconciliationStrategyContext
 * @property {object} application
 * @property {object[]} rawUserDocs
 * @property {object} meta
 * @property {object} [engineTimings]
 */

/**
 * Strategy-owned reconciliation lifecycle.
 * Future SCIM / REST / SAP / Oracle strategies can implement the same contract
 * with completely different execution DAGs.
 *
 * @typedef {object} IReconciliationStrategy
 * @property {(ctx: ReconciliationStrategyContext) => Promise<object>} prepare
 * @property {(ctx: object) => object} buildExecutionGraph
 * @property {(graph: object, ctx: object) => Promise<object>} execute
 * @property {(ctx: object, result: object) => Promise<object>} verify
 * @property {(ctx: object, result: object) => Promise<object>} finalize
 */

/**
 * Run the full strategy lifecycle and return the same summary shape as runReconciliation.
 * @param {IReconciliationStrategy} strategy
 * @param {ReconciliationStrategyContext} initialCtx
 */
export async function runStrategyLifecycle(strategy, initialCtx) {
  const prepared = await strategy.prepare(initialCtx);
  const graph = strategy.buildExecutionGraph(prepared);
  const executed = await strategy.execute(graph, prepared);
  await strategy.verify(prepared, executed);
  return strategy.finalize(prepared, executed);
}
