import {
  computeAccountEntryHashes,
  reclassifyHashPartitionForLiveUserRepair,
  resolveStableSyncKey,
  HASH_ALGORITHM_VERSION,
} from "./accountHashService.js";
import { buildAccountEntryFromDoc } from "../reconciliation/reconciliationAccountUtils.js";

const userMappings = [
  { standardField: "user_id", csvColumn: "sAMAccountName", isPrimaryKey: true },
  { standardField: "email", csvColumn: "mail" },
  { standardField: "status", csvColumn: "userAccountControl" },
];

function sampleDoc(overrides = {}) {
  return {
    user_id: "jdoe",
    email: "jdoe@example.com",
    status: "512",
    rawData: {
      objectGUID: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
      sAMAccountName: "jdoe",
      mail: "jdoe@example.com",
      userAccountControl: "512",
      ad_memberOf_dns: ["CN=Staff,DC=corp,DC=local", "CN=IT,DC=corp,DC=local"],
      lastLogonTimestamp: "133000000000000000",
      whenChanged: "20260101120000.0Z",
      ...overrides.rawData,
    },
    ...overrides,
  };
}

describe("accountHashService incremental sync", () => {
  test("computeAccountEntryHashes is deterministic for same logical account", () => {
    const doc = sampleDoc();
    const entry = buildAccountEntryFromDoc(doc, userMappings, "user_id", {});
    const a = computeAccountEntryHashes(entry);
    const b = computeAccountEntryHashes(entry);
    expect(a.accountHash).toBe(b.accountHash);
    expect(a.membershipHash).toBe(b.membershipHash);
  });

  test("volatile LDAP attributes do not change account hash", () => {
    const entry1 = buildAccountEntryFromDoc(sampleDoc(), userMappings, "user_id", {});
    const base = sampleDoc();
    const entry2 = buildAccountEntryFromDoc(
      {
        ...base,
        rawData: {
          ...base.rawData,
          lastLogonTimestamp: "999999999999999999",
          whenChanged: "20991231120000.0Z",
        },
      },
      userMappings,
      "user_id",
      {},
    );
    expect(computeAccountEntryHashes(entry1).accountHash).toBe(
      computeAccountEntryHashes(entry2).accountHash,
    );
  });

  test("array member order does not change membership hash", () => {
    const entry1 = buildAccountEntryFromDoc(
      sampleDoc({
        rawData: {
          ad_memberOf_dns: ["CN=B,DC=corp,DC=local", "CN=A,DC=corp,DC=local"],
        },
      }),
      userMappings,
      "user_id",
      {},
    );
    const entry2 = buildAccountEntryFromDoc(
      sampleDoc({
        rawData: {
          ad_memberOf_dns: ["CN=A,DC=corp,DC=local", "CN=B,DC=corp,DC=local"],
        },
      }),
      userMappings,
      "user_id",
      {},
    );
    expect(computeAccountEntryHashes(entry1).membershipHash).toBe(
      computeAccountEntryHashes(entry2).membershipHash,
    );
  });

  test("resolveStableSyncKey prefers objectGUID", () => {
    const entry = buildAccountEntryFromDoc(sampleDoc(), userMappings, "user_id", {});
    expect(resolveStableSyncKey(entry, "user_id")).toBe(
      "guid:A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    );
  });

  test("reclassifyHashPartitionForLiveUserRepair only marks missing PKs as new", () => {
    const docA = sampleDoc({ user_id: "alice" });
    const docB = sampleDoc({
      user_id: "bob",
      rawData: {
        ...sampleDoc().rawData,
        objectGUID: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
        sAMAccountName: "bob",
      },
    });
    const map = new Map([
      ["alice", buildAccountEntryFromDoc(docA, userMappings, "user_id", {})],
      ["bob", buildAccountEntryFromDoc(docB, userMappings, "user_id", {})],
    ]);
    const partition = {
      unchangedPkKeys: ["alice", "bob"],
      unchangedKeys: ["guid:A1B2C3D4-E5F6-7890-ABCD-EF1234567890", "guid:BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"],
      newPkKeys: [],
      newKeys: [],
      changedPkKeys: [],
      changedKeys: [],
      syncKeyByPkKey: new Map([
        ["alice", "guid:A1B2C3D4-E5F6-7890-ABCD-EF1234567890"],
        ["bob", "guid:BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"],
      ]),
      stateByKey: new Map(),
      membershipHashByKey: new Map(),
    };
    reclassifyHashPartitionForLiveUserRepair(partition, map, "user_id", new Set(["alice"]));
    expect(partition.unchangedPkKeys).toEqual(["alice"]);
    expect(partition.newPkKeys).toEqual(["bob"]);
    expect(partition.newKeys).toContain("guid:BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB");
  });

  test("hash algorithm version constant is stable", () => {
    expect(HASH_ALGORITHM_VERSION).toBeGreaterThan(0);
  });
});
