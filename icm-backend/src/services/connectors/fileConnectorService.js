/**
 * File-based connectors (CSV / LDIF / XML paths) — validates intent; full server-side file ingest needs secure paths.
 */

export function normalizeFileConfig(input = {}) {
  return {
    path: String(input.path ?? input.filePath ?? '').trim(),
    format: String(input.format ?? 'csv').toLowerCase(),
  };
}

export async function testFileConnector(raw) {
  const cfg = normalizeFileConfig(raw);
  if (!cfg.path) {
    throw new Error('File path is required (server-accessible path for batch jobs).');
  }
  return {
    ok: true,
    sampleCount: 0,
    hint:
      'Path recorded. Deploy a file drop or scheduled job that reads this path; interactive upload uses Application CSV upload instead.',
  };
}

export async function fetchFileUsers() {
  throw new Error(
    'User import from file path is not executed from this API. Use CSV upload on the application or configure a scheduled worker.'
  );
}
