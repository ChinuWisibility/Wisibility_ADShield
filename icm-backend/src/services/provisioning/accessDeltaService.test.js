import { describe, expect, test } from "@jest/globals";
import { calculateAccessDelta, computeAccessDelta } from "./accessDeltaService.js";

const TENANT = "tenant-a";
const IDENTITY = "identity-a";
const AD = "app-ad";
const M365 = "app-m365";
const ORACLE = "app-oracle";

function desired(applications = []) {
  return {
    tenantId: TENANT,
    identityId: IDENTITY,
    lifecycleType: "JOINER",
    lifecycleEventId: "event-1",
    jmlCorrelationId: "JML-20260816-test",
    applications,
  };
}

function actual(applications = []) {
  return {
    tenantId: TENANT,
    identityId: IDENTITY,
    applications,
    metadata: { source: "IGA_AGGREGATION_AND_CORRELATION" },
  };
}

function desiredApp(overrides = {}) {
  return {
    applicationId: AD,
    applicationName: "Directory",
    accountRequired: true,
    attributes: {},
    entitlements: [],
    ...overrides,
  };
}

function actualApp(overrides = {}) {
  return {
    applicationId: AD,
    applicationName: "Directory",
    account: { exists: true, nativeId: "alice", attributes: {} },
    entitlements: [],
    ...overrides,
  };
}

describe("Access Delta Engine account semantics", () => {
  test("desired account + no actual → ADD_ACCOUNT", () => {
    const result = calculateAccessDelta(desired([desiredApp()]), actual());
    expect(result.applications[0].account).toEqual(
      expect.objectContaining({ operation: "ADD_ACCOUNT", attributeOperation: "NONE" }),
    );
  });

  test("desired account + actual account → RETAIN_ACCOUNT", () => {
    const result = calculateAccessDelta(desired([desiredApp()]), actual([actualApp()]));
    expect(result.applications[0].account.operation).toBe("RETAIN_ACCOUNT");
  });

  test("no desired account + actual account → REMOVE_ACCOUNT", () => {
    const result = calculateAccessDelta(desired(), actual([actualApp()]));
    expect(result.applications[0].account.operation).toBe("REMOVE_ACCOUNT");
  });

  test("neither desired nor actual → no application delta", () => {
    expect(calculateAccessDelta(desired(), actual()).applications).toEqual([]);
  });

  test("only explicit desired attributes participate in update delta", () => {
    const result = calculateAccessDelta(
      desired([desiredApp({ attributes: { department: "IT" } })]),
      actual([actualApp({ account: { exists: true, nativeId: "alice", attributes: { department: "IT", createdAt: "ignored" } } })]),
    );
    expect(result.applications[0].account.attributeOperation).toBe("NONE");
    expect(result.applications[0].account.attributesChanged).toEqual({});
  });

  test("one and multiple changed attributes produce only changed fields", () => {
    const result = calculateAccessDelta(
      desired([desiredApp({ attributes: { department: "IT", title: "Senior Analyst" } })]),
      actual([actualApp({ account: { exists: true, nativeId: "alice", attributes: { department: "Finance", title: "Analyst", extra: "ignore" } } })]),
    );
    expect(result.applications[0].account).toEqual(
      expect.objectContaining({
        operation: "RETAIN_ACCOUNT",
        attributeOperation: "UPDATE_ACCOUNT",
        attributesChanged: {
          department: { old: "Finance", new: "IT" },
          title: { old: "Analyst", new: "Senior Analyst" },
        },
      }),
    );
  });
});

describe("Access Delta Engine entitlement semantics", () => {
  test("missing desired entitlement → ADD", () => {
    const result = calculateAccessDelta(
      desired([desiredApp({ entitlements: [{ entitlementId: "e-it", name: "IT" }] })]),
      actual([actualApp()]),
    );
    expect(result.applications[0].entitlements.add).toEqual([
      expect.objectContaining({ entitlementId: "e-it" }),
    ]);
  });

  test("actual entitlement absent from desired → REMOVE", () => {
    const result = calculateAccessDelta(
      desired([desiredApp()]),
      actual([actualApp({ entitlements: [{ entitlementId: "e-fin", name: "FINANCE" }] })]),
    );
    expect(result.applications[0].entitlements.remove).toEqual([
      expect.objectContaining({ entitlementId: "e-fin" }),
    ]);
  });

  test("matching stable entitlement ID → RETAIN despite display-name variation", () => {
    const result = calculateAccessDelta(
      desired([desiredApp({ entitlements: [{ entitlementId: "e-it", name: "IT" }] })]),
      actual([actualApp({ entitlements: [{ entitlementId: "e-it", name: "Information Technology" }] })]),
    );
    expect(result.applications[0].entitlements.retain).toEqual([
      expect.objectContaining({ entitlementId: "e-it" }),
    ]);
  });

  test("duplicate and reordered entitlements normalize to the same delta", () => {
    const first = calculateAccessDelta(
      desired([desiredApp({ entitlements: [{ name: "VPN" }, { name: "IT" }, { name: "VPN" }] })]),
      actual([actualApp({ entitlements: [{ name: "IT" }, { name: "VPN" }] })]),
    );
    const second = calculateAccessDelta(
      desired([desiredApp({ entitlements: [{ name: "IT" }, { name: "VPN" }] })]),
      actual([actualApp({ entitlements: [{ name: "VPN" }, { name: "IT" }, { name: "IT" }] })]),
    );
    expect(first).toEqual(second);
    expect(first.applications[0].entitlements.retain).toHaveLength(2);
  });

  test("application-declared case-insensitive entitlement semantics are honored", () => {
    const result = calculateAccessDelta(
      desired([desiredApp({ entitlements: [{ name: "VPN-Users" }], comparison: { caseInsensitiveEntitlements: true } })]),
      actual([actualApp({ entitlements: [{ name: "vpn-users" }] })]),
    );
    expect(result.applications[0].entitlements.retain).toHaveLength(1);
  });
});

describe("Access Delta Engine multi-app and safety", () => {
  test("multi-application desired-only, actual-only, and retained apps are all calculated", () => {
    const result = calculateAccessDelta(
      desired([
        desiredApp(),
        { applicationId: M365, applicationName: "M365", accountRequired: true, attributes: {}, entitlements: [] },
      ]),
      actual([
        actualApp(),
        { applicationId: ORACLE, applicationName: "Oracle", account: { exists: true, nativeId: "x", attributes: {} }, entitlements: [] },
      ]),
    );
    expect(result.applications.map((app) => [app.applicationId, app.account.operation])).toEqual([
      [AD, "RETAIN_ACCOUNT"],
      [M365, "ADD_ACCOUNT"],
      [ORACLE, "REMOVE_ACCOUNT"],
    ]);
  });

  test.each(["JOINER", "MOVER", "LEAVER", "REHIRE"])(
    "passes lifecycle context %s without execution",
    (lifecycleType) => {
      const result = calculateAccessDelta(desired([desiredApp()]), actual(), { lifecycleType });
      expect(result.lifecycleType).toBe(lifecycleType);
      expect(result.metadata).toEqual(
        expect.objectContaining({
          targetWrites: false,
          provisioningTasksCreated: false,
          workflowExecuted: false,
          connectorInvoked: false,
        }),
      );
    },
  );

  test("same input is idempotent and deterministic", () => {
    const inputDesired = desired([desiredApp({ attributes: { department: "IT" } })]);
    const inputActual = actual([actualApp({ account: { exists: true, nativeId: "alice", attributes: { department: "Finance" } } })]);
    expect(calculateAccessDelta(inputDesired, inputActual)).toEqual(
      calculateAccessDelta(inputDesired, inputActual),
    );
  });

  test("tenant or identity mismatch is rejected", () => {
    expect(() =>
      calculateAccessDelta(desired([desiredApp()]), {
        ...actual([actualApp()]),
        tenantId: "tenant-b",
      }),
    ).toThrow("same tenant and identity");
    expect(() =>
      calculateAccessDelta(desired([desiredApp()]), {
        ...actual([actualApp()]),
        identityId: "identity-b",
      }),
    ).toThrow("same tenant and identity");
  });

  test("secrets are never returned as account attribute deltas", () => {
    const result = calculateAccessDelta(
      desired([desiredApp({ attributes: { password: "new-secret-value", department: "IT" } })]),
      actual([actualApp({ account: { exists: true, nativeId: "a", attributes: { password: "old-secret-value", department: "Finance" } } })]),
    );
    expect(result.applications[0].account.attributesChanged).toEqual({
      department: { old: "Finance", new: "IT" },
    });
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("new-secret-value");
    expect(JSON.stringify(result)).not.toContain("old-secret-value");
  });

  test("computeAccessDelta orchestrates injected desired/actual without side effects", async () => {
    const result = await computeAccessDelta({
      identity: { _id: IDENTITY, tenantId: TENANT },
      context: { tenantId: TENANT, lifecycleType: "MOVER" },
      desiredAccess: desired([desiredApp({ entitlements: [{ entitlementId: "e-vpn", name: "VPN" }] })]),
      actualAccess: actual([
        actualApp({ entitlements: [{ entitlementId: "e-it", name: "IT" }] }),
      ]),
    });
    expect(result.lifecycleType).toBe("MOVER");
    expect(result.applications[0].account.operation).toBe("RETAIN_ACCOUNT");
    expect(result.applications[0].entitlements.add).toEqual([
      expect.objectContaining({ entitlementId: "e-vpn" }),
    ]);
    expect(result.applications[0].entitlements.remove).toEqual([
      expect.objectContaining({ entitlementId: "e-it" }),
    ]);
    expect(result.metadata.targetWrites).toBe(false);
    expect(result.metadata.provisioningTasksCreated).toBe(false);
  });

  test("explicit removeEntitlements force REMOVE even when also listed as desired", () => {
    const result = calculateAccessDelta(
      desired([
        desiredApp({
          entitlements: [
            { entitlementId: "e-keep", name: "Keep" },
            { entitlementId: "e-drop", name: "Drop" },
          ],
          removeEntitlements: [{ entitlementId: "e-drop", name: "Drop" }],
        }),
      ]),
      actual([
        actualApp({
          entitlements: [
            { entitlementId: "e-keep", name: "Keep" },
            { entitlementId: "e-drop", name: "Drop" },
          ],
        }),
      ]),
    );
    expect(result.applications[0].entitlements.retain).toEqual([
      expect.objectContaining({ entitlementId: "e-keep" }),
    ]);
    expect(result.applications[0].entitlements.remove).toEqual([
      expect.objectContaining({ entitlementId: "e-drop" }),
    ]);
    expect(result.applications[0].entitlements.add).toEqual([]);
  });
});

