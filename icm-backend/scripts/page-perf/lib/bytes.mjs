/** Byte helpers for page-perf harness. */
export function bytesOf(obj) {
  return Buffer.byteLength(JSON.stringify(obj ?? null), "utf8");
}

export function fieldContributions(rows, { topN = 12 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const keys = new Set();
  for (const row of rows) {
    if (row && typeof row === "object") Object.keys(row).forEach((k) => keys.add(k));
  }
  return [...keys]
    .map((field) => ({
      field,
      bytes: bytesOf(rows.map((row) => ({ [field]: row?.[field] }))),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, topN);
}

export function projectRows(rows, fields) {
  if (!Array.isArray(rows)) return [];
  const set = new Set(fields || []);
  return rows.map((row) => {
    const out = {};
    for (const key of set) {
      if (row && Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
    }
    return out;
  });
}
