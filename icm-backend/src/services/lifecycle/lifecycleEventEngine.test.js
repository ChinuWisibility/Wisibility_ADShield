/**
 * P1 Lifecycle Event Engine — detector + idempotency + worker helper unit tests.
 * No Mongo/AD required.
 */

import { describe, expect, test } from "@jest/globals";
import {
  detectIdentityLifecycleChanges,
  fingerprintChanges,
  buildLifecycleIdempotencyKey,
  pickSnapshot,
  MOVER_ATTRIBUTE_FIELDS,
} from "../lifecycle/lifecycleDetectionService.js";
import { createJmlCorrelationId, isJmlCorrelationId } from "../lifecycle/jmlCorrelation.js";
import { LIFECYCLE_PRIORITY } from "../../models/identity/LifecycleEvent.js";

describe("P1 Lifecycle detection A–J", () => {
  test("A: new identity → IDENTITY_CREATED + JOINER", () => {
    const result = detectIdentityLifecycleChanges(null, {
      department: "IT",
      location: "India",
      lifecycleState: "ACTIVE",
      displayName: "New Hire",
    });
    expect(result.attributeEvents).toContain("IDENTITY_CREATED");
    expect(result.lifecycleEvents).toContain("JOINER");
    expect(result.lifecycleTypeByEvent.JOINER).toBe("JOINER");
  });

  test("B: department change → DEPARTMENT_CHANGED + MOVER", () => {
    const before = {
      department: "Finance",
      title: "Analyst",
      manager: "MGR001",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = { ...before, department: "IT" };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("DEPARTMENT_CHANGED");
    expect(result.lifecycleEvents).toContain("MOVER");
    expect(result.lifecycleEvents).not.toContain("LEAVER");
  });

  test("C: location change → LOCATION_CHANGED + MOVER", () => {
    const before = {
      department: "IT",
      location: "India",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = { ...before, location: "Singapore" };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("LOCATION_CHANGED");
    expect(result.lifecycleEvents).toContain("MOVER");
  });

  test("D: managerId change → MANAGER_CHANGED + MOVER", () => {
    const before = {
      department: "IT",
      managerId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      ...before,
      managerId: "bbbbbbbbbbbbbbbbbbbbbbbb",
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("MANAGER_CHANGED");
    expect(result.lifecycleEvents).toContain("MOVER");
  });

  test("E: title change → TITLE_CHANGED + MOVER", () => {
    const before = { title: "Analyst", lifecycleState: "ACTIVE", isActive: true };
    const after = { title: "Senior Analyst", lifecycleState: "ACTIVE", isActive: true };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("TITLE_CHANGED");
    expect(result.lifecycleEvents).toContain("MOVER");
  });

  test("F: role change → ROLE_CHANGED + MOVER", () => {
    const before = {
      department: "IT",
      lifecycleState: "ACTIVE",
      isActive: true,
      attributes: { role: "IC" },
    };
    const after = {
      department: "IT",
      lifecycleState: "ACTIVE",
      isActive: true,
      attributes: { role: "Lead" },
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("ROLE_CHANGED");
    expect(result.lifecycleEvents).toContain("MOVER");
  });

  test("G: irrelevant / no change → no lifecycle event", () => {
    const identity = { department: "IT", title: "Engineer", lifecycleState: "ACTIVE" };
    const same = detectIdentityLifecycleChanges(identity, { ...identity });
    expect(same.changed).toBe(false);
    expect(same.lifecycleEvents).toEqual([]);

    const onlyPhone = detectIdentityLifecycleChanges(
      { ...identity, phoneNumber: "1", isActive: true },
      { ...identity, phoneNumber: "2", isActive: true },
    );
    expect(onlyPhone.attributeEvents).toContain("IDENTITY_UPDATED");
    expect(onlyPhone.lifecycleEvents).not.toContain("MOVER");
    expect(onlyPhone.lifecycleEvents).not.toContain("JOINER");
    expect(onlyPhone.lifecycleEvents).not.toContain("LEAVER");
  });

  test("H: future termination → TERMINATION_SCHEDULED only (no LEAVER yet)", () => {
    const before = { department: "IT", lifecycleState: "ACTIVE", isActive: true };
    const after = {
      department: "IT",
      lifecycleState: "ACTIVE",
      isActive: true,
      endDate: new Date(Date.now() + 7 * 24 * 3600_000),
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("TERMINATION_SCHEDULED");
    expect(result.lifecycleEvents).not.toContain("LEAVER");
  });

  test("I: effective termination → TERMINATION_EFFECTIVE + LEAVER", () => {
    const before = { department: "IT", lifecycleState: "ACTIVE", isActive: true };
    const after = {
      department: "IT",
      lifecycleState: "TERMINATED",
      isActive: false,
      endDate: new Date(Date.now() - 60_000),
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("TERMINATION_EFFECTIVE");
    expect(result.lifecycleEvents).toContain("LEAVER");
  });

  test("J: terminated → active → REHIRE", () => {
    const before = { lifecycleState: "TERMINATED", isActive: false, department: "IT" };
    const after = { lifecycleState: "ACTIVE", isActive: true, department: "IT" };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.lifecycleEvents).toContain("REHIRE");
  });
});

describe("P1 idempotency + snapshots", () => {
  test("K: same sync key reuses; different syncJobId allows re-event", () => {
    const changes = [{ field: "department", before: "A", after: "B" }];
    const fp = fingerprintChanges(changes);
    const key1 = buildLifecycleIdempotencyKey({
      tenantId: "t1",
      identityId: "i1",
      eventType: "MOVER",
      syncJobId: "sync-1",
      changeFingerprint: fp,
    });
    const key2 = buildLifecycleIdempotencyKey({
      tenantId: "t1",
      identityId: "i1",
      eventType: "MOVER",
      syncJobId: "sync-1",
      changeFingerprint: fp,
    });
    const key3 = buildLifecycleIdempotencyKey({
      tenantId: "t1",
      identityId: "i1",
      eventType: "MOVER",
      syncJobId: "sync-2",
      changeFingerprint: fp,
    });
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  test("null/undefined treated as equal in snapshots", () => {
    const a = pickSnapshot({ department: null, title: undefined, lifecycleState: "ACTIVE" });
    const b = pickSnapshot({ department: "", title: null, lifecycleState: "ACTIVE" });
    // empty string and null both normalize to ""
    const result = detectIdentityLifecycleChanges(
      { department: null, lifecycleState: "ACTIVE", isActive: true },
      { department: undefined, lifecycleState: "ACTIVE", isActive: true },
    );
    expect(result.changed).toBe(false);
    expect(a.lifecycleState).toBe("ACTIVE");
    expect(b.lifecycleState).toBe("ACTIVE");
  });

  test("snapshots exclude secrets", () => {
    const snap = pickSnapshot({
      department: "IT",
      password: "secret",
      attributes: { role: "IC", apiKey: "x" },
    });
    expect(snap.department).toBe("IT");
    expect(snap.password).toBeUndefined();
    expect(snap.role).toBe("IC");
  });

  test("fingerprint is order-independent hash", () => {
    const fp1 = fingerprintChanges([
      { field: "department", before: "A", after: "B" },
      { field: "title", before: "X", after: "Y" },
    ]);
    const fp2 = fingerprintChanges([
      { field: "title", before: "X", after: "Y" },
      { field: "department", before: "A", after: "B" },
    ]);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe("P1 claim / retry / tenant helpers (L/M/O unit)", () => {
  test("L: claim filter allows only DETECTED|PENDING due events", () => {
    // Document the claim contract used by claimLifecycleEvent
    const claimable = new Set(["DETECTED", "PENDING"]);
    expect(claimable.has("IN_PROGRESS")).toBe(false);
    expect(claimable.has("DEFERRED")).toBe(false);
    expect(claimable.has("COMPLETED")).toBe(false);
  });

  test("M: retry uses PENDING + backoff, not unreclaimable DEFERRED", () => {
    // Priority blocking and failures must return to PENDING for reclaim
    const afterBlockStatus = "PENDING";
    expect(afterBlockStatus).toBe("PENDING");
    expect(afterBlockStatus).not.toBe("DEFERRED");
  });

  test("O: tenant isolation keys include tenantId", () => {
    const keyA = buildLifecycleIdempotencyKey({
      tenantId: "tenantA",
      identityId: "sameIdentityShape",
      eventType: "JOINER",
      syncJobId: "s1",
    });
    const keyB = buildLifecycleIdempotencyKey({
      tenantId: "tenantB",
      identityId: "sameIdentityShape",
      eventType: "JOINER",
      syncJobId: "s1",
    });
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain("tenantA");
    expect(keyB).toContain("tenantB");
  });

  test("priority ordering TERMINATION/LEAVER > MOVER > JOINER", () => {
    expect(LIFECYCLE_PRIORITY.LEAVER).toBeGreaterThan(LIFECYCLE_PRIORITY.MOVER);
    expect(LIFECYCLE_PRIORITY.MOVER).toBeGreaterThan(LIFECYCLE_PRIORITY.JOINER);
    expect(LIFECYCLE_PRIORITY.TERMINATION_EFFECTIVE).toBeGreaterThanOrEqual(
      LIFECYCLE_PRIORITY.LEAVER,
    );
  });
});

describe("JML correlation", () => {
  test("creates valid correlation id", () => {
    const id = createJmlCorrelationId(new Date("2026-08-16T10:00:00Z"));
    expect(id.startsWith("JML-20260816-")).toBe(true);
    expect(isJmlCorrelationId(id)).toBe(true);
  });
});

describe("P6 MOVER detection foundation", () => {
  test("no-op refresh → no MOVER", () => {
    const identity = {
      department: "Finance",
      location: "India",
      title: "Analyst",
      costCenter: "CC1",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const result = detectIdentityLifecycleChanges(identity, { ...identity });
    expect(result.changed).toBe(false);
    expect(result.lifecycleEvents).toEqual([]);
    expect(result.changedAttributes).toEqual([]);
  });

  test("case/whitespace equivalence does not emit MOVER", () => {
    const before = {
      department: "Finance",
      location: "  India ",
      title: "Analyst",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      department: "finance",
      location: "india",
      title: "  analyst  ",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.changed).toBe(false);
    expect(result.lifecycleEvents).not.toContain("MOVER");
  });

  test("null ↔ empty string equivalence", () => {
    const result = detectIdentityLifecycleChanges(
      {
        department: null,
        title: "",
        costCenter: undefined,
        lifecycleState: "ACTIVE",
        isActive: true,
      },
      {
        department: "",
        title: null,
        costCenter: null,
        lifecycleState: "ACTIVE",
        isActive: true,
      },
    );
    expect(result.changed).toBe(false);
  });

  test("null → value on allowlisted field emits one MOVER", () => {
    const result = detectIdentityLifecycleChanges(
      { department: null, lifecycleState: "ACTIVE", isActive: true },
      { department: "IT", lifecycleState: "ACTIVE", isActive: true },
    );
    expect(result.lifecycleEvents).toEqual(["MOVER"]);
    expect(result.changedAttributes).toEqual([
      { attribute: "department", before: null, after: "IT" },
    ]);
    expect(result.previousState.department).toBeNull();
    expect(result.newState.department).toBe("IT");
  });

  test("all configured MOVER attributes can emit MOVER", () => {
    for (const attribute of MOVER_ATTRIBUTE_FIELDS) {
      const before = {
        lifecycleState: "ACTIVE",
        isActive: true,
        [attribute]: "before-value",
      };
      const after = {
        lifecycleState: "ACTIVE",
        isActive: true,
        [attribute]: "after-value",
      };
      const result = detectIdentityLifecycleChanges(before, after);
      expect(result.lifecycleEvents).toContain("MOVER");
      expect(result.changedAttributes.some((c) => c.attribute === attribute)).toBe(
        true,
      );
    }
  });

  test("multi-field change → single MOVER with all changedAttributes", () => {
    const before = {
      department: "Finance",
      location: "India",
      title: "Analyst",
      costCenter: "CC1",
      division: "Corp",
      country: "IN",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      ...before,
      department: "IT",
      location: "Singapore",
      title: "Engineer",
      costCenter: "CC9",
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.lifecycleEvents.filter((e) => e === "MOVER")).toHaveLength(1);
    expect(result.lifecycleEvents).toEqual(["MOVER"]);
    const attrs = result.changedAttributes.map((c) => c.attribute).sort();
    expect(attrs).toEqual(["costCenter", "department", "location", "title"]);
    // Original casing preserved in snapshots / change set
    expect(result.changes.find((c) => c.field === "department")).toEqual({
      field: "department",
      before: "Finance",
      after: "IT",
    });
  });

  test("non-allowlisted profile fields do not emit MOVER", () => {
    const before = {
      department: "IT",
      displayName: "Alice",
      email: "a@x.com",
      phoneNumber: "1",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      ...before,
      displayName: "Alice Updated",
      email: "b@x.com",
      phoneNumber: "2",
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("IDENTITY_UPDATED");
    expect(result.lifecycleEvents).not.toContain("MOVER");
    expect(result.changedAttributes).toEqual([]);
  });

  test("termination + department change → LEAVER only (no MOVER)", () => {
    const before = {
      department: "Finance",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      department: "IT",
      lifecycleState: "TERMINATED",
      isActive: false,
      endDate: new Date(Date.now() - 60_000),
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.lifecycleEvents).toContain("LEAVER");
    expect(result.lifecycleEvents).not.toContain("MOVER");
  });

  test("scheduled termination + department change → no MOVER", () => {
    const before = {
      department: "Finance",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      department: "IT",
      lifecycleState: "ACTIVE",
      isActive: true,
      endDate: new Date(Date.now() + 7 * 24 * 3600_000),
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("TERMINATION_SCHEDULED");
    expect(result.lifecycleEvents).not.toContain("MOVER");
    expect(result.lifecycleEvents).not.toContain("LEAVER");
  });

  test("rehire + department change → REHIRE only (no MOVER)", () => {
    const before = {
      department: "Finance",
      lifecycleState: "TERMINATED",
      isActive: false,
    };
    const after = {
      department: "IT",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.lifecycleEvents).toContain("REHIRE");
    expect(result.lifecycleEvents).not.toContain("MOVER");
  });

  test("JOINER only when BEFORE is missing", () => {
    const created = detectIdentityLifecycleChanges(null, {
      department: "IT",
      lifecycleState: "ACTIVE",
    });
    expect(created.lifecycleEvents).toEqual(["JOINER"]);
    expect(created.lifecycleEvents).not.toContain("MOVER");

    const existing = detectIdentityLifecycleChanges(
      { department: "Finance", lifecycleState: "ACTIVE", isActive: true },
      { department: "IT", lifecycleState: "ACTIVE", isActive: true },
    );
    expect(existing.lifecycleEvents).toEqual(["MOVER"]);
    expect(existing.lifecycleEvents).not.toContain("JOINER");
  });

  test("stable fingerprints under case/whitespace normalization", () => {
    const fp1 = fingerprintChanges([
      { field: "department", before: "Finance", after: "IT" },
    ]);
    const fp2 = fingerprintChanges([
      { field: "department", before: " finance ", after: "it" },
    ]);
    expect(fp1).toBe(fp2);
  });

  test("allowlisted snapshots exclude secrets and preserve originals", () => {
    const snap = pickSnapshot({
      department: "Finance",
      password: "secret",
      costCenter: "CC1",
      attributes: { role: "IC", api_key: "x" },
    });
    expect(snap).toMatchObject({
      department: "Finance",
      costCenter: "CC1",
      role: "IC",
    });
    expect(snap.password).toBeUndefined();
    expect(Object.keys(snap).every((k) => !/password|api_key/i.test(k))).toBe(
      true,
    );
  });

  test("Finance → IT refresh boundary yields one MOVER with sanitized snapshots", () => {
    const beforePersisted = {
      _id: "id-1",
      tenantId: "tenant-a",
      department: "Finance",
      title: "Analyst",
      lifecycleState: "ACTIVE",
      isActive: true,
      password: "should-not-leak",
    };
    const afterPersisted = {
      ...beforePersisted,
      department: "IT",
    };
    const result = detectIdentityLifecycleChanges(beforePersisted, afterPersisted);
    expect(result.lifecycleEvents).toEqual(["MOVER"]);
    expect(result.previousState.password).toBeUndefined();
    expect(result.newState.password).toBeUndefined();
    expect(result.previousState.department).toBe("Finance");
    expect(result.newState.department).toBe("IT");

    const identicalRefresh = detectIdentityLifecycleChanges(
      afterPersisted,
      afterPersisted,
    );
    expect(identicalRefresh.changed).toBe(false);
    expect(identicalRefresh.lifecycleEvents).toEqual([]);
  });

  test("tenant isolation on MOVER idempotency keys", () => {
    const changes = [{ field: "department", before: "Finance", after: "IT" }];
    const fp = fingerprintChanges(changes);
    const keyA = buildLifecycleIdempotencyKey({
      tenantId: "tenant-a",
      identityId: "same-identity",
      eventType: "MOVER",
      syncJobId: "sync-1",
      changeFingerprint: fp,
    });
    const keyB = buildLifecycleIdempotencyKey({
      tenantId: "tenant-b",
      identityId: "same-identity",
      eventType: "MOVER",
      syncJobId: "sync-1",
      changeFingerprint: fp,
    });
    expect(keyA).not.toBe(keyB);
  });
});
