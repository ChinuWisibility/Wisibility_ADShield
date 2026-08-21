/**
 * Correctness + concurrency tests for shared bulkWrite helper and
 * upsertIdentitySyncStateBatch parallelization.
 */
import { describe, expect, test, beforeAll, afterEach, jest } from "@jest/globals";
import {
  bulkWriteChunkedParallel,
} from "../../utils/csvUploadPerformance.js";
import {
  upsertIdentitySyncStateBatch,
  computeAccountEntryHashes,
  resolveStableSyncKey,
} from "./accountHashService.js";
import { buildAccountEntryFromDoc } from "../reconciliation/reconciliationAccountUtils.js";

const userMappings = [
  { standardField: "user_id", csvColumn: "user_id", isPrimaryKey: true },
  { standardField: "email", csvColumn: "email" },
  { standardField: "status", csvColumn: "status" },
];

function makeEntry(userId, guid) {
  const doc = {
    user_id: userId,
    email: `${userId}@ex.com`,
    status: "active",
    rawData: {
      objectGUID: guid,
      user_id: userId,
    },
  };
  return buildAccountEntryFromDoc(doc, userMappings, "user_id", {});
}

function buildMaps(entries) {
  const currentMap = new Map();
  const hashByKey = new Map();
  const membershipHashByKey = new Map();
  const objectGuidByKey = new Map();
  const userIdByIdentityKey = new Map();
  for (const [pk, entry] of entries) {
    currentMap.set(pk, entry);
    const syncKey = resolveStableSyncKey(entry, "user_id");
    const hashes = computeAccountEntryHashes(entry);
    hashByKey.set(syncKey, hashes.accountHash);
    membershipHashByKey.set(syncKey, hashes.membershipHash);
    objectGuidByKey.set(syncKey, hashes.objectGuid || "");
    userIdByIdentityKey.set(syncKey, `oid-${pk}`);
  }
  return {
    currentMap,
    hashByKey,
    membershipHashByKey,
    objectGuidByKey,
    userIdByIdentityKey,
  };
}

describe("bulkWriteChunkedParallel", () => {
  test("empty ops returns zeroed counts and does not call bulkWrite", async () => {
    const bulkWrite = jest.fn();
    const Model = { bulkWrite };
    const res = await bulkWriteChunkedParallel(Model, [], { chunkSize: 1000, concurrency: 3 });
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(res).toEqual({
      upsertedCount: 0,
      modifiedCount: 0,
      matchedCount: 0,
      deletedCount: 0,
      chunkCount: 0,
      waveCount: 0,
    });
  });

  test("uses ordered:false and aggregates BulkWriteResult counts", async () => {
    const bulkWrite = jest.fn().mockResolvedValue({
      upsertedCount: 2,
      modifiedCount: 3,
      matchedCount: 5,
      deletedCount: 0,
    });
    const Model = { bulkWrite };
    const ops = Array.from({ length: 5 }, (_, i) => ({
      updateOne: { filter: { i }, update: { $set: { i } }, upsert: true },
    }));
    const res = await bulkWriteChunkedParallel(Model, ops, { chunkSize: 1000, concurrency: 3 });
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
    expect(res.upsertedCount).toBe(2);
    expect(res.modifiedCount).toBe(3);
    expect(res.chunkCount).toBe(1);
    expect(res.waveCount).toBe(1);
  });

  test("caps concurrency to 3 and runs waves sequentially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const bulkWrite = jest.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return { upsertedCount: 1, modifiedCount: 0, matchedCount: 1, deletedCount: 0 };
    });
    const Model = { bulkWrite };
    // 7 chunks of size 1 → with concurrency 3: waves of 3,3,1
    const ops = Array.from({ length: 7 }, (_, i) => ({
      updateOne: { filter: { i }, update: { $set: { i } }, upsert: true },
    }));
    const t0 = Date.now();
    const res = await bulkWriteChunkedParallel(Model, ops, { chunkSize: 1, concurrency: 3 });
    const elapsed = Date.now() - t0;
    expect(bulkWrite).toHaveBeenCalledTimes(7);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(res.chunkCount).toBe(7);
    expect(res.waveCount).toBe(3);
    // Sequential would be ~140ms; 3 waves × 20ms ≈ 60ms (+jitter)
    expect(elapsed).toBeLessThan(120);
  });

  test("parallel wall time beats serial for many chunks (mock RTT)", async () => {
    const RTT_MS = 40;
    const makeModel = () => ({
      bulkWrite: jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, RTT_MS));
        return { upsertedCount: 10, modifiedCount: 0, matchedCount: 10, deletedCount: 0 };
      }),
    });

    const ops = Array.from({ length: 5000 }, (_, i) => ({
      updateOne: { filter: { identityKey: `k${i}` }, update: { $set: { i } }, upsert: true },
    }));

    // Serial baseline (mirror old upsertIdentitySyncStateBatch loop)
    const serialModel = makeModel();
    const tSerial0 = Date.now();
    for (let i = 0; i < ops.length; i += 1000) {
      const chunk = ops.slice(i, i + 1000);
      await serialModel.bulkWrite(chunk, { ordered: false });
    }
    const serialMs = Date.now() - tSerial0;

    const parallelModel = makeModel();
    const tPar0 = Date.now();
    const res = await bulkWriteChunkedParallel(parallelModel, ops, {
      chunkSize: 1000,
      concurrency: 3,
    });
    const parallelMs = Date.now() - tPar0;

    // 5 chunks: serial ≈ 5×RTT, parallel ≈ 2 waves (3+2) ≈ 2×RTT
    expect(serialModel.bulkWrite).toHaveBeenCalledTimes(5);
    expect(parallelModel.bulkWrite).toHaveBeenCalledTimes(5);
    expect(res.waveCount).toBe(2);
    expect(parallelMs).toBeLessThan(serialMs);
    // Allow timer jitter on Windows; still expect clear speedup vs 5 serial RTTs.
    expect(parallelMs).toBeLessThan(serialMs * 0.85);
  });
});

describe("upsertIdentitySyncStateBatch — op construction (behaviour preserved)", () => {
  /**
   * We monkey-patch IdentitySyncState methods on the module's model by injecting
   * through the already-imported function's dependency. Since IdentitySyncState is
   * a real mongoose model, we stub its bulkWrite / updateMany / deleteMany for unit tests.
   */
  let IdentitySyncState;
  let originalBulkWrite;
  let originalUpdateMany;
  let originalDeleteMany;

  beforeAll(async () => {
    ({ default: IdentitySyncState } = await import("../../models/sync/IdentitySyncState.js"));
    originalBulkWrite = IdentitySyncState.bulkWrite;
    originalUpdateMany = IdentitySyncState.updateMany;
    originalDeleteMany = IdentitySyncState.deleteMany;
  });

  afterEach(() => {
    IdentitySyncState.bulkWrite = originalBulkWrite;
    IdentitySyncState.updateMany = originalUpdateMany;
    IdentitySyncState.deleteMany = originalDeleteMany;
  });

  function stubWrites({ bulkWriteImpl, updateManyImpl, deleteManyImpl } = {}) {
    const bulkCalls = [];
    const updateCalls = [];
    const deleteCalls = [];
    IdentitySyncState.bulkWrite = jest.fn().mockImplementation(async (ops, opts) => {
      bulkCalls.push({ ops, opts });
      if (bulkWriteImpl) return bulkWriteImpl(ops, opts);
      return {
        upsertedCount: ops.length,
        modifiedCount: 0,
        matchedCount: ops.length,
        deletedCount: 0,
      };
    });
    IdentitySyncState.updateMany = jest.fn().mockImplementation(async (filter, update) => {
      updateCalls.push({ filter, update });
      if (updateManyImpl) return updateManyImpl(filter, update);
      const n = filter?.identityKey?.$in?.length || 0;
      return { modifiedCount: n, matchedCount: n };
    });
    IdentitySyncState.deleteMany = jest.fn().mockImplementation(async (filter) => {
      deleteCalls.push({ filter });
      if (deleteManyImpl) return deleteManyImpl(filter);
      return { deletedCount: filter?.identityKey?.$in?.length || 0 };
    });
    return { bulkCalls, updateCalls, deleteCalls };
  }

  test("first import: full upserts for all accounts, no touch, no deletes", async () => {
    const e1 = makeEntry("u1", "11111111-1111-1111-1111-111111111111");
    const e2 = makeEntry("u2", "22222222-2222-2222-2222-222222222222");
    const maps = buildMaps([
      ["u1", e1],
      ["u2", e2],
    ]);
    const { bulkCalls, updateCalls, deleteCalls } = stubWrites();

    const result = await upsertIdentitySyncStateBatch({
      applicationId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      runId: "R_TEST_1",
      ...maps,
      removedKeys: [],
      pkField: "user_id",
      // null syncKeysToFullUpsert → all currentMap keys
    });

    expect(result.attempted).toBe(2);
    expect(result.touched).toBe(0);
    expect(bulkCalls.length).toBeGreaterThanOrEqual(1);
    expect(bulkCalls.every((c) => c.opts.ordered === false)).toBe(true);
    const allOps = bulkCalls.flatMap((c) => c.ops);
    expect(allOps).toHaveLength(2);
    for (const op of allOps) {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.update.$set.accountHash).toMatch(/^[a-f0-9]{64}$/);
      expect(op.updateOne.update.$set.hashVersion).toBeGreaterThan(0);
      expect(op.updateOne.update.$set.lastSyncRunId).toBe("R_TEST_1");
    }
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  test("unchanged re-import touch path: updateMany only for touch keys when full upsert set empty", async () => {
    const e1 = makeEntry("u1", "11111111-1111-1111-1111-111111111111");
    const maps = buildMaps([["u1", e1]]);
    const syncKey = resolveStableSyncKey(e1, "user_id");
    const { bulkCalls, updateCalls, deleteCalls } = stubWrites();

    const result = await upsertIdentitySyncStateBatch({
      applicationId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      runId: "R_TEST_TOUCH",
      ...maps,
      removedKeys: [],
      pkField: "user_id",
      syncKeysToFullUpsert: [], // empty set → no full upserts
      syncKeysToTouch: [syncKey],
    });

    expect(result.attempted).toBe(0);
    expect(result.touched).toBe(1);
    expect(bulkCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].filter.identityKey.$in).toEqual([syncKey]);
    expect(updateCalls[0].update.$set.lastSyncRunId).toBe("R_TEST_TOUCH");
    expect(deleteCalls).toHaveLength(0);
  });

  test("partial delta: only new/changed keys get full upserts; unchanged are touched", async () => {
    const eNew = makeEntry("new1", "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
    const eChg = makeEntry("chg1", "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
    const eUn = makeEntry("un1", "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC");
    const maps = buildMaps([
      ["new1", eNew],
      ["chg1", eChg],
      ["un1", eUn],
    ]);
    const kNew = resolveStableSyncKey(eNew, "user_id");
    const kChg = resolveStableSyncKey(eChg, "user_id");
    const kUn = resolveStableSyncKey(eUn, "user_id");
    const { bulkCalls, updateCalls } = stubWrites();

    await upsertIdentitySyncStateBatch({
      applicationId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      runId: "R_DELTA",
      ...maps,
      removedKeys: [],
      pkField: "user_id",
      syncKeysToFullUpsert: [kNew, kChg],
      syncKeysToTouch: [kUn],
    });

    const upsertKeys = bulkCalls
      .flatMap((c) => c.ops)
      .map((op) => op.updateOne.filter.identityKey)
      .sort();
    expect(upsertKeys).toEqual([kChg, kNew].sort());
    expect(updateCalls[0].filter.identityKey.$in).toEqual([kUn]);
  });

  test("removed accounts: deleteMany after writes with identityKey $in", async () => {
    const e1 = makeEntry("u1", "11111111-1111-1111-1111-111111111111");
    const maps = buildMaps([["u1", e1]]);
    const { deleteCalls } = stubWrites();

    await upsertIdentitySyncStateBatch({
      applicationId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      runId: "R_RM",
      ...maps,
      removedKeys: ["guid:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF", "pk:gone"],
      pkField: "user_id",
      syncKeysToFullUpsert: [],
      syncKeysToTouch: [],
    });

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].filter.identityKey.$in).toEqual([
      "guid:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF",
      "pk:gone",
    ]);
  });

  test("membership hash is written on full upsert (membership-change path)", async () => {
    const e1 = makeEntry("u1", "11111111-1111-1111-1111-111111111111");
    // Attach AD-style member DNs so membershipHash is non-empty
    e1.rawDoc.rawData.ad_memberOf_dns = ["CN=A,DC=x", "CN=B,DC=x"];
    const maps = buildMaps([["u1", e1]]);
    const syncKey = resolveStableSyncKey(e1, "user_id");
    const expectedMembership = computeAccountEntryHashes(e1).membershipHash;
    const { bulkCalls } = stubWrites();

    await upsertIdentitySyncStateBatch({
      applicationId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      runId: "R_MEM",
      ...maps,
      removedKeys: [],
      pkField: "user_id",
      syncKeysToFullUpsert: [syncKey],
    });

    const op = bulkCalls.flatMap((c) => c.ops)[0];
    expect(op.updateOne.update.$set.membershipHash).toBe(expectedMembership);
    expect(op.updateOne.update.$set.membershipHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("5000-op first import uses parallel waves (≤3 in flight) via shared helper", async () => {
    const entries = [];
    for (let i = 0; i < 5000; i += 1) {
      const hex = i.toString(16).padStart(12, "0");
      const guid = `00000000-0000-0000-0000-${hex}`;
      entries.push([`u${i}`, makeEntry(`u${i}`, guid)]);
    }
    const maps = buildMaps(entries);

    let inFlight = 0;
    let maxInFlight = 0;
    IdentitySyncState.bulkWrite = jest.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { upsertedCount: 1000, modifiedCount: 0, matchedCount: 1000, deletedCount: 0 };
    });
    IdentitySyncState.updateMany = jest.fn();
    IdentitySyncState.deleteMany = jest.fn();

    const result = await upsertIdentitySyncStateBatch({
      applicationId: "507f1f77bcf86cd799439011",
      tenantId: "507f1f77bcf86cd799439012",
      runId: "R_5K",
      ...maps,
      removedKeys: [],
      pkField: "user_id",
    });

    expect(result.attempted).toBe(5000);
    expect(IdentitySyncState.bulkWrite).toHaveBeenCalledTimes(5); // 5000/1000
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // proves parallelism vs old serial
  });
});
