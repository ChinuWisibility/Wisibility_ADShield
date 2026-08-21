/**
 * Optional command-level metrics for identity entitlement sync.
 * Enable with IDENTITY_ENTITLEMENT_SYNC_METRICS=1
 */

let enabled = process.env.IDENTITY_ENTITLEMENT_SYNC_METRICS === "1";
let active = null;

export function setSyncMetricsEnabled(on) {
  enabled = Boolean(on);
}

export function isSyncMetricsEnabled() {
  return enabled;
}

export function beginSyncMetrics(label = "sync") {
  if (!enabled) return null;
  // Nesting: if already active (e.g. harness), keep outer span and don't reset.
  if (active) {
    active.nested = (active.nested || 0) + 1;
    return active;
  }
  active = {
    label,
    startedAt: Date.now(),
    heapUsedStart: process.memoryUsage().heapUsed,
    cpuStart: typeof process.cpuUsage === "function" ? process.cpuUsage() : null,
    commands: 0,
    find: 0,
    findOne: 0,
    aggregate: 0,
    insert: 0,
    update: 0,
    delete: 0,
    bulkWrite: 0,
    bulkWriteOps: 0,
    deleteMany: 0,
    other: 0,
    byCollection: {},
    nested: 0,
  };
  return active;
}

export function endSyncMetrics(extra = {}) {
  if (!enabled || !active) return null;
  if (active.nested > 0) {
    active.nested -= 1;
    if (extra && typeof extra === "object") {
      Object.assign(active, { lastNestedExtra: extra });
    }
    return null;
  }
  const ended = Date.now();
  const heapUsedEnd = process.memoryUsage().heapUsed;
  let cpuMs = null;
  if (active.cpuStart && typeof process.cpuUsage === "function") {
    const cpu = process.cpuUsage(active.cpuStart);
    cpuMs = Math.round((cpu.user + cpu.system) / 1000);
  }
  const result = {
    ...active,
    ...extra,
    durationMs: ended - active.startedAt,
    heapDeltaMb: Math.round(((heapUsedEnd - active.heapUsedStart) / 1024 / 1024) * 100) / 100,
    heapAfterMb: Math.round((heapUsedEnd / 1024 / 1024) * 100) / 100,
    cpuMs,
  };
  active = null;
  return result;
}

export function recordMongoCommand(event) {
  if (!enabled || !active) return;
  const name = String(event?.commandName || "other");
  active.commands += 1;
  const coll =
    event?.command?.collection ||
    event?.command?.[name]?.collection ||
    event?.command?.aggregate ||
    event?.command?.find ||
    event?.command?.delete ||
    event?.command?.update ||
    "unknown";
  const collKey = typeof coll === "string" ? coll : "unknown";
  active.byCollection[collKey] = (active.byCollection[collKey] || 0) + 1;

  if (name === "find") active.find += 1;
  else if (name === "findOne" || name === "findAndModify") active.findOne += 1;
  else if (name === "aggregate") active.aggregate += 1;
  else if (name === "insert" || name === "insertMany") active.insert += 1;
  else if (name === "update" || name === "updateMany" || name === "updateOne") active.update += 1;
  else if (name === "delete" || name === "deleteMany" || name === "deleteOne") {
    active.delete += 1;
    active.deleteMany += 1;
  } else if (name === "bulkWrite" || name === "update" && event?.command?.updates) {
    active.bulkWrite += 1;
  } else {
    active.other += 1;
  }

  // Mongoose bulkWrite surfaces as multiple update commands; also track explicit counter
  if (Array.isArray(event?.command?.updates)) {
    active.bulkWriteOps += event.command.updates.length;
    active.bulkWrite += 1;
  }
  if (Array.isArray(event?.command?.deletes)) {
    active.deleteMany += event.command.deletes.length;
  }
}

export function recordBulkWriteOps(count) {
  if (!enabled || !active) return;
  active.bulkWrite += 1;
  active.bulkWriteOps += Number(count) || 0;
}

export function recordDeleteMany() {
  if (!enabled || !active) return;
  active.deleteMany += 1;
  active.delete += 1;
}

export function getActiveSyncMetrics() {
  return active;
}
