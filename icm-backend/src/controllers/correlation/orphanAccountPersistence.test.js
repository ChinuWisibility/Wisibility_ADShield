/**
 * Unit + regression tests for orphan account persistence identity.
 *
 * Bug: upserts keyed by (applicationId, correlationKey) overwrote multiple
 * accounts that shared a correlation attribute (e.g. "Service Account").
 * Fix: document identity is (applicationId, accountId); correlationKey is metadata.
 */
import {
  orphanDocumentFilter,
  orphanPurgeFilter,
  buildOrphanUpsertOp,
} from "./orphanAccountPersistence.js";

describe("orphanAccountPersistence identity", () => {
  const appId = "6a0c9631ef2e72d877e56699";

  test("orphanDocumentFilter uses applicationId + accountId only", () => {
    const filter = orphanDocumentFilter(appId, "6a0c96576906065e04926111");
    expect(filter).toEqual({
      applicationId: appId,
      accountId: "6a0c96576906065e04926111",
    });
    expect(filter).not.toHaveProperty("correlationKey");
  });

  test("accountId is always stringified", () => {
    const filter = orphanDocumentFilter(appId, { toString: () => "abc123" });
    expect(filter.accountId).toBe("abc123");
  });

  test("orphanPurgeFilter deletes only by accountId list — never correlationKey", () => {
    const filter = orphanPurgeFilter(appId, ["a1", "a2"]);
    expect(filter).toEqual({
      applicationId: appId,
      accountId: { $in: ["a1", "a2"] },
    });
    expect(JSON.stringify(filter)).not.toContain("correlationKey");
  });

  test("buildOrphanUpsertOp filter is account-scoped; correlationKey is $set metadata", () => {
    const op = buildOrphanUpsertOp({
      applicationId: appId,
      tenantId: "tenant1",
      accountId: "acct-1",
      accountName: "svc.etl.pipeline",
      correlationKey: "v:service account",
      lastLoginAt: null,
    });

    expect(op.updateOne.filter).toEqual({
      applicationId: appId,
      accountId: "acct-1",
    });
    expect(op.updateOne.filter).not.toHaveProperty("correlationKey");
    expect(op.updateOne.update.$set.correlationKey).toBe("v:service account");
    expect(op.updateOne.update.$set.accountId).toBe("acct-1");
    expect(op.updateOne.update.$set.status).toBe("OPEN");
    expect(op.updateOne.upsert).toBe(true);
    expect(op.updateOne.update.$setOnInsert).toHaveProperty("detectedAt");
  });
});

describe("regression: same correlationKey, different accountId", () => {
  const appId = "sap-app";
  const sharedKey = "v:service account";
  const accounts = [
    { id: "6a0c96576906065e04926111", name: "svc.etl.pipeline" },
    { id: "6a0c96576906065e049261bd", name: "report.svc.finance" },
    { id: "6a0c96586906065e049263a8", name: "svc.batch.runner" },
    { id: "6a0c965a6906065e049266d1", name: "svc.integration.01" },
  ];

  test("four service accounts produce four distinct upsert filters", () => {
    const ops = accounts.map((a) =>
      buildOrphanUpsertOp({
        applicationId: appId,
        tenantId: "t1",
        accountId: a.id,
        accountName: a.name,
        correlationKey: sharedKey,
      }),
    );

    const filters = ops.map((o) => o.updateOne.filter);
    const filterKeys = new Set(filters.map((f) => `${f.applicationId}|${f.accountId}`));
    expect(filterKeys.size).toBe(4);

    // All share metadata key but not identity
    expect(new Set(ops.map((o) => o.updateOne.update.$set.correlationKey))).toEqual(
      new Set([sharedKey]),
    );
  });

  test("simulating bulk upsert map does not overwrite siblings", () => {
    // Emulate Mongo upsert identity: last write wins per filter key only.
    const store = new Map();
    for (const a of accounts) {
      const op = buildOrphanUpsertOp({
        applicationId: appId,
        tenantId: "t1",
        accountId: a.id,
        accountName: a.name,
        correlationKey: sharedKey,
      });
      const identity = JSON.stringify(op.updateOne.filter);
      store.set(identity, op.updateOne.update.$set.accountName);
    }
    expect(store.size).toBe(4);
    expect([...store.values()].sort()).toEqual(
      [
        "report.svc.finance",
        "svc.batch.runner",
        "svc.etl.pipeline",
        "svc.integration.01",
      ].sort(),
    );
  });

  test("legacy correlationKey identity WOULD collapse to one row (documents the bug)", () => {
    const store = new Map();
    for (const a of accounts) {
      const legacyFilter = { applicationId: appId, correlationKey: sharedKey };
      store.set(JSON.stringify(legacyFilter), a.name);
    }
    expect(store.size).toBe(1);
    expect([...store.values()][0]).toBe("svc.integration.01");
  });
});

describe("purge regression: linked account must not delete siblings with same key", () => {
  test("purge filter for one account does not include shared correlationKey", () => {
    const linkedAccountId = "6a0c96576906065e04926111";
    const filter = orphanPurgeFilter("sap-app", [linkedAccountId]);
    expect(filter.accountId.$in).toEqual([linkedAccountId]);
    expect(filter).not.toHaveProperty("$or");
    expect(filter).not.toHaveProperty("correlationKey");
  });

  test("purging two linked accounts targets only those accountIds", () => {
    const filter = orphanPurgeFilter("sap-app", ["a1", "a2"]);
    expect(filter.accountId.$in).toEqual(["a1", "a2"]);
  });
});

describe("scenario matrix: identity coverage", () => {
  const cases = [
    { name: "one orphan", accountIds: ["a1"], key: "v:alice@ex.com" },
    { name: "multiple orphans distinct keys", accountIds: ["a1", "a2"], keyFn: (id) => `v:${id}@ex.com` },
    { name: "multiple service accounts same key", accountIds: ["s1", "s2", "s3"], key: "v:service account" },
    { name: "duplicate usernames different accountId", accountIds: ["u1", "u2"], key: "v:jdoe" },
    { name: "empty correlation value uses aid metadata", accountIds: ["e1"], key: "aid:e1" },
    { name: "multiple applications", accountIds: ["a1"], apps: ["appA", "appB"], key: "v:same" },
  ];

  test.each(cases)("$name yields one document per (app, accountId)", (tc) => {
    const apps = tc.apps || ["app1"];
    const store = new Map();
    for (const applicationId of apps) {
      for (const accountId of tc.accountIds) {
        const correlationKey =
          typeof tc.keyFn === "function" ? tc.keyFn(accountId) : tc.key;
        const op = buildOrphanUpsertOp({
          applicationId,
          tenantId: "t",
          accountId,
          accountName: accountId,
          correlationKey,
        });
        store.set(JSON.stringify(op.updateOne.filter), true);
      }
    }
    expect(store.size).toBe(apps.length * tc.accountIds.length);
  });
});
