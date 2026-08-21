/**
 * Bounded-concurrency bulk write helpers for CsvMappedReconciliationStrategy only.
 * Default reconciliation paths keep using reconciliationCollections.bulkInsertChunked.
 */

export const CSV_BULK_DEFAULTS = {
  // Smaller chunks + higher concurrency overlap remote Mongo RTT better than one giant write.
  chunkSize: Number(process.env.CSV_IMPORT_BULK_CHUNK || 1000) || 1000,
  concurrency: Number(process.env.CSV_IMPORT_BULK_CONCURRENCY || 8) || 8,
};

/**
 * @param {import('mongoose').Model} Model
 * @param {object[]} docs
 * @param {{ chunkSize?: number, concurrency?: number, useNative?: boolean }} [opts]
 */
export async function csvInsertManyChunked(Model, docs, opts = {}) {
  if (!docs?.length) return 0;
  const chunkSize = opts.chunkSize || CSV_BULK_DEFAULTS.chunkSize;
  const concurrency = Math.max(1, opts.concurrency || CSV_BULK_DEFAULTS.concurrency);
  const useNative = opts.useNative === true;

  const chunks = [];
  for (let i = 0; i < docs.length; i += chunkSize) {
    chunks.push(docs.slice(i, i + chunkSize));
  }

  let inserted = 0;
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (chunk) => {
        if (useNative) {
          const res = await Model.collection.insertMany(chunk, {
            ordered: false,
          });
          return Object.keys(res.insertedIds || {}).length;
        }
        const res = await Model.insertMany(chunk, { ordered: false });
        return res.length;
      }),
    );
    for (const n of results) inserted += n;
  }
  return inserted;
}

/**
 * @param {import('mongoose').Model} Model
 * @param {object[]} ops
 * @param {{ chunkSize?: number, concurrency?: number, useNative?: boolean }} [opts]
 */
export async function csvBulkWriteChunked(Model, ops, opts = {}) {
  if (!ops?.length) return;
  const chunkSize = opts.chunkSize || CSV_BULK_DEFAULTS.chunkSize;
  const concurrency = Math.max(1, opts.concurrency || CSV_BULK_DEFAULTS.concurrency);
  const useNative = opts.useNative === true;

  const chunks = [];
  for (let i = 0; i < ops.length; i += chunkSize) {
    chunks.push(ops.slice(i, i + chunkSize));
  }

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    await Promise.all(
      batch.map((chunk) =>
        useNative
          ? Model.collection.bulkWrite(chunk, { ordered: false })
          : Model.bulkWrite(chunk, { ordered: false }),
      ),
    );
  }
}

/**
 * Run independent async tasks with a dependency DAG.
 * @param {Map<string, { deps?: string[], run: () => Promise<any> }>} nodes
 */
export async function runExecutionGraph(nodes) {
  const results = new Map();
  const pending = new Map(nodes);
  const inFlight = new Map();

  while (pending.size > 0 || inFlight.size > 0) {
    const ready = [];
    for (const [id, node] of pending) {
      const deps = node.deps || [];
      if (deps.every((d) => results.has(d))) {
        ready.push(id);
      }
    }
    if (!ready.length && !inFlight.size) {
      throw new Error(
        `Execution graph deadlock; remaining nodes: ${[...pending.keys()].join(", ")}`,
      );
    }
    for (const id of ready) {
      const node = pending.get(id);
      pending.delete(id);
      const p = Promise.resolve()
        .then(() => node.run())
        .then((value) => {
          results.set(id, value);
          inFlight.delete(id);
          return value;
        });
      inFlight.set(id, p);
    }
    if (inFlight.size) {
      await Promise.race([...inFlight.values()]);
    }
  }
  return results;
}
