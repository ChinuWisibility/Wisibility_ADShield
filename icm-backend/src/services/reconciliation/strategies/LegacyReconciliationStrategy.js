import { runReconciliation } from "../reconciliationOrchestrator.js";
import { runStrategyLifecycle } from "./IReconciliationStrategy.js";

/**
 * Thin adapter: delegates entirely to existing runReconciliation.
 * Used by AD / universal connector / strict CSV / HRMS paths (zero semantic change).
 */
export class LegacyReconciliationStrategy {
  constructor(label = "legacy") {
    this.label = label;
  }

  async prepare(ctx) {
    return { ...ctx, _legacy: true };
  }

  buildExecutionGraph(ctx) {
    return {
      nodes: new Map([
        [
          "legacyRunReconciliation",
          {
            deps: [],
            run: async () =>
              runReconciliation(ctx.application, ctx.rawUserDocs, ctx.meta || {}),
          },
        ],
      ]),
    };
  }

  async execute(graph, ctx) {
    const node = graph.nodes.get("legacyRunReconciliation");
    const result = await node.run();
    return { result };
  }

  async verify() {
    return { ok: true };
  }

  async finalize(_ctx, executed) {
    return executed.result;
  }
}

export async function runLegacyReconciliationStrategy(application, rawUserDocs, meta = {}) {
  const strategy = new LegacyReconciliationStrategy(String(meta.source || "legacy"));
  return runStrategyLifecycle(strategy, { application, rawUserDocs, meta });
}

/** AD / universal connector adapter */
export class ConnectorStrategy extends LegacyReconciliationStrategy {
  constructor() {
    super("connector");
  }
}

/** Strict CSV adapter */
export class CsvStrictStrategy extends LegacyReconciliationStrategy {
  constructor() {
    super("csv_strict");
  }
}

/** HRMS delimited adapter */
export class HrmsStrategy extends LegacyReconciliationStrategy {
  constructor() {
    super("hrms");
  }
}
