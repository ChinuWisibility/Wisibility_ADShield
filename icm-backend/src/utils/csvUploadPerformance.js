import { Readable } from "stream";
import csv from "csv-parser";

/** Hard ceiling on CSV rows accepted by any import path \u2014 bounds worst-case
 * memory use independent of the multer file-size limit (a maximally-dense
 * CSV can still contain millions of tiny rows within a 100MB cap). */
export const DEFAULT_MAX_CSV_ROWS = 250000;

/**
 * Stream-parse a CSV buffer (multer memory upload) without Papa.parse loading a second string copy.
 * @param {Buffer} buffer
 * @param {{ maxRows?: number }} [opts]
 * @returns {Promise<{ rows: object[], fields: string[] }>}
 */
export function parseCsvBufferStreaming(buffer, opts = {}) {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_CSV_ROWS;
  return new Promise((resolve, reject) => {
    const rows = [];
    let fields = [];
    const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ""), "utf8");

    const stream = Readable.from(input).pipe(
      csv({
        mapHeaders: ({ header }) =>
          String(header || "")
            .replace(/^\uFEFF/, "")
            .trim(),
        skipLines: 0,
        strict: false,
      }),
    );

    stream
      .on("headers", (headers) => {
        fields = (headers || []).map((h) => String(h || "").trim()).filter(Boolean);
      })
      .on("data", (row) => {
        if (!fields.length) {
          fields = Object.keys(row || {}).map((h) => String(h || "").trim()).filter(Boolean);
        }
        // Drop fully empty rows
        const hasValue = Object.values(row || {}).some(
          (v) => v != null && String(v).trim() !== "",
        );
        if (hasValue) rows.push(row);
        if (rows.length > maxRows) {
          stream.destroy();
          reject(
            new Error(
              `CSV exceeds the maximum of ${maxRows.toLocaleString()} rows \u2014 split the file and import in batches.`,
            ),
          );
        }
      })
      .on("error", reject)
      .on("end", () => resolve({ rows, fields }));
  });
}

/**
 * Run bulkWrite in chunks with limited parallelism (reduces remote Mongo RTT wall time).
 *
 * Behaviour (stable contract used by reconciliation / ingest):
 * - Chunk size default 1000; concurrency default 3 (clamped to ≥1).
 * - Each chunk uses `{ ordered: false }` — within a chunk, ops may complete out of order
 *   and a single-op failure does not roll back sibling ops in that chunk (Mongo default for unordered).
 * - Waves are sequential: at most `concurrency` chunks run via Promise.all; the next wave
 *   starts only after the previous wave settles. Cross-chunk ordering is therefore
 *   wave-ordered, not globally ordered — callers must ensure ops are independent
 *   (e.g. distinct IdentitySyncState keys).
 * - No automatic retries. On any rejection in a wave, Promise.all rejects immediately;
 *   sibling chunks in that wave may already have committed (same class of partial failure
 *   as a single unordered bulkWrite that fails mid-batch).
 * - Empty `ops` is a no-op and returns zeroed counts.
 *
 * @param {import('mongoose').Model} Model
 * @param {object[]} ops
 * @param {{ chunkSize?: number, concurrency?: number }} [opts]
 * @returns {Promise<{
 *   upsertedCount: number,
 *   modifiedCount: number,
 *   matchedCount: number,
 *   deletedCount: number,
 *   chunkCount: number,
 *   waveCount: number,
 * }>}
 */
export async function bulkWriteChunkedParallel(Model, ops, opts = {}) {
  const chunkSize = opts.chunkSize || 1000;
  const concurrency = Math.max(1, opts.concurrency || 3);
  const empty = {
    upsertedCount: 0,
    modifiedCount: 0,
    matchedCount: 0,
    deletedCount: 0,
    chunkCount: 0,
    waveCount: 0,
  };
  if (!ops?.length) return empty;

  const chunks = [];
  for (let i = 0; i < ops.length; i += chunkSize) {
    chunks.push(ops.slice(i, i + chunkSize));
  }

  let upsertedCount = 0;
  let modifiedCount = 0;
  let matchedCount = 0;
  let deletedCount = 0;
  let waveCount = 0;

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    waveCount += 1;
    const results = await Promise.all(
      batch.map((chunk) => Model.bulkWrite(chunk, { ordered: false })),
    );
    for (const res of results) {
      upsertedCount += res?.upsertedCount || 0;
      modifiedCount += res?.modifiedCount || 0;
      matchedCount += res?.matchedCount || 0;
      deletedCount += res?.deletedCount || 0;
    }
  }

  return {
    upsertedCount,
    modifiedCount,
    matchedCount,
    deletedCount,
    chunkCount: chunks.length,
    waveCount,
  };
}
