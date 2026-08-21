/**
 * Minimal Express-like response for in-process controller benchmarks.
 * JSON serialization cost is included (same work Express performs for res.json).
 */
export function createMockResponse() {
  let statusCode = 200;
  let payload;
  let serialized;
  let serializeMs = 0;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      const t0 = process.hrtime.bigint();
      serialized = JSON.stringify(value);
      serializeMs = Number(process.hrtime.bigint() - t0) / 1e6;
      return this;
    },
    result() {
      return {
        statusCode,
        payload,
        serialized,
        serializeMs,
        payloadBytes: serialized ? Buffer.byteLength(serialized, "utf8") : 0,
      };
    },
  };
}

export function createAdminRequest({ tenantId, query = {}, params = {}, body = {} } = {}) {
  return {
    query: { tenantId, ...query },
    params,
    body,
    user: { role: "admin", tenantId, _id: "perf-harness" },
    scopedTenantId: tenantId,
    headers: {},
  };
}
