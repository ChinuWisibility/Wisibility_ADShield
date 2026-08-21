/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + cost,
      );
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * @param {string} unknown
 * @param {string[]} candidates
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function closestMatches(unknown, candidates, opts = {}) {
  const limit = opts.limit ?? 5;
  if (!unknown || !candidates?.length) return [];
  const lower = unknown.toLowerCase();
  const scored = candidates
    .map((c) => {
      const lc = String(c).toLowerCase();
      let d = levenshteinDistance(lower, lc);
      if (lc.includes(lower) || lower.includes(lc)) {
        d = Math.min(d, 2);
      }
      return { c, d };
    })
    .filter((x) => x.c !== unknown)
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c));
  const out = [];
  const seen = new Set();
  for (const { c } of scored) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
