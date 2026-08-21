/**
 * Integration-style regression: index contract + migration helpers for orphan identity.
 * Does not require a live MongoDB — validates migration module exports and index specs.
 */
import {
  MIGRATION_ID,
  SOURCE_COLLECTION,
  BACKUP_COLLECTION,
  MARKER_COLLECTION,
} from "../../../migrations/025_orphan_account_identity.mjs";

describe("025 orphan identity migration contract", () => {
  test("migration identifiers are stable", () => {
    expect(MIGRATION_ID).toBe("025_orphan_account_identity");
    expect(SOURCE_COLLECTION).toBe("orphan_accounts");
    expect(BACKUP_COLLECTION).toBe("orphan_accounts_backup_025");
    expect(MARKER_COLLECTION).toBe("_schema_migrations");
  });
});

describe("OrphanAccount schema index contract (source)", () => {
  test("model declares unique account identity and non-unique correlationKey", async () => {
    // Dynamic import after env so mongoose model loads once.
    const { default: OrphanAccount } = await import("../../models/identity/OrphanAccount.js");
    const indexes = OrphanAccount.schema.indexes();

    const accountIdx = indexes.find(
      ([key]) => key.applicationId === 1 && key.accountId === 1 && Object.keys(key).length === 2,
    );
    const corrIdx = indexes.find(
      ([key]) =>
        key.applicationId === 1 && key.correlationKey === 1 && Object.keys(key).length === 2,
    );

    expect(accountIdx).toBeTruthy();
    expect(accountIdx[1]?.unique).toBe(true);

    expect(corrIdx).toBeTruthy();
    expect(corrIdx[1]?.unique).not.toBe(true);
  });
});
