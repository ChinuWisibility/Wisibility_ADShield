import { describe, expect, test } from "@jest/globals";
import {
  compileProvisioningPlan,
  isProvisioningPlanLockedAgainstRecompile,
  translateAccessDeltaToPlanItems,
} from "./provisioningPlanCompiler.js";
import {
  classifyProvisioningOperation,
  EXECUTION_CLASS,
  REASON_CODE,
  resolveConnectorFamily,
} from "./provisioningCapabilityCatalog.js";

const TENANT = "64aaaaaaaaaaaaaaaaaaaaa1";
const IDENTITY = "64bbbbbbbbbbbbbbbbbbbbbb";
const EVENT = "event-1";
const CORR = "JML-20260816-plan";
const AD = "64cccccccccccccccccccccc";
const CSV_A = "64dddddddddddddddddddddd";
const CSV_B = "64eeeeeeeeeeeeeeeeeeeeee";

function identity(overrides = {}) {
  return {
    _id: IDENTITY,
    tenantId: TENANT,
    employeeId: "E100",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Example",
    displayName: "Alice Example",
    ...overrides,
  };
}

function delta(applications, overrides = {}) {
  return {
    tenantId: TENANT,
    identityId: IDENTITY,
    lifecycleType: "JOINER",
    lifecycleEventId: EVENT,
    jmlCorrelationId: CORR,
    applications,
    metadata: {
      evaluationMode: "ACCESS_DELTA_ONLY",
      actualAccessSource: "CALLER_SUPPLIED",
      targetWrites: false,
    },
    ...overrides,
  };
}

function adApp(overrides = {}) {
  return {
    _id: AD,
    name: "Directory",
    tenantId: TENANT,
    status: "active",
    connectorType: "ACTIVE_DIRECTORY",
    connectionConfig: {
      ad: {
        url: "ldaps://dc.example.com",
        bindDn: "cn=bind,dc=example,dc=com",
        targetOuDn: "ou=Users,dc=example,dc=com",
        // bindPassword intentionally omitted from readiness? catalog checks url/bindDn/targetOuDn only
      },
    },
    ...overrides,
  };
}

function csvApp(id, name, overrides = {}) {
  return {
    _id: id,
    name,
    tenantId: TENANT,
    status: "active",
    connectorType: "CONNECTOR_DELIMITEDFILE",
    connectionConfig: { provisioningTestMode: "csv" },
    ...overrides,
  };
}

async function compile(accessDelta, opts = {}) {
  return compileProvisioningPlan({
    identity: opts.identity || identity(),
    lifecycleEvent: opts.lifecycleEvent || {
      _id: EVENT,
      tenantId: TENANT,
      identityId: IDENTITY,
      jmlCorrelationId: CORR,
    },
    desiredAccess: opts.desiredAccess || null,
    actualAccess: opts.actualAccess || null,
    accessDelta,
    context: {
      tenantId: TENANT,
      applications: opts.applications || [adApp(), csvApp(CSV_A, "AppA"), csvApp(CSV_B, "AppB")],
      dryRun: opts.dryRun !== undefined ? opts.dryRun : true,
      requestId: opts.requestId,
      ...opts.context,
    },
  });
}

describe("translateAccessDeltaToPlanItems", () => {
  test("ADD_ACCOUNT creates a plan item", () => {
    const items = translateAccessDeltaToPlanItems(
      delta([
        {
          applicationId: AD,
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
    );
    expect(items).toEqual([
      expect.objectContaining({ operationType: "ADD_ACCOUNT", applicationId: AD }),
    ]);
  });

  test("UPDATE_ACCOUNT from attribute delta", () => {
    const items = translateAccessDeltaToPlanItems(
      delta([
        {
          applicationId: AD,
          account: {
            operation: "RETAIN_ACCOUNT",
            attributeOperation: "UPDATE_ACCOUNT",
            attributesChanged: { department: { old: "Finance", new: "IT" } },
          },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
    );
    expect(items.map((i) => i.operationType)).toEqual(["UPDATE_ACCOUNT"]);
    expect(items[0].attributesChanged.department).toEqual({ old: "Finance", new: "IT" });
  });

  test("REMOVE_ACCOUNT maps to DISABLE when desired.accountDisabled", () => {
    const items = translateAccessDeltaToPlanItems(
      delta([
        {
          applicationId: AD,
          account: { operation: "REMOVE_ACCOUNT", attributeOperation: "NONE", actualNativeId: "dn" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
      {
        applications: [{ applicationId: AD, accountDisabled: true, attributes: {} }],
      },
    );
    expect(items[0].operationType).toBe("DISABLE");
  });

  test("REMOVE_ACCOUNT stays REMOVE when not disabled intent", () => {
    const items = translateAccessDeltaToPlanItems(
      delta([
        {
          applicationId: AD,
          account: { operation: "REMOVE_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
    );
    expect(items[0].operationType).toBe("REMOVE_ACCOUNT");
  });

  test("ADD and REMOVE entitlement items; RETAIN omitted", () => {
    const items = translateAccessDeltaToPlanItems(
      delta([
        {
          applicationId: AD,
          account: { operation: "RETAIN_ACCOUNT", attributeOperation: "NONE" },
          entitlements: {
            add: [{ entitlementId: "e-vpn", name: "VPN" }],
            retain: [{ entitlementId: "e-keep", name: "Keep" }],
            remove: [{ entitlementId: "e-fin", name: "Finance" }],
          },
        },
      ]),
    );
    expect(items.map((i) => i.operationType).sort()).toEqual([
      "ADD_ENTITLEMENT",
      "REMOVE_ENTITLEMENT",
    ]);
    expect(items.every((i) => i.entitlement?.entitlementId !== "e-keep")).toBe(true);
  });

  test("RETAIN and NOOP create no items", () => {
    expect(
      translateAccessDeltaToPlanItems(
        delta([
          {
            applicationId: AD,
            account: { operation: "RETAIN_ACCOUNT", attributeOperation: "NONE" },
            entitlements: { add: [], retain: [{ entitlementId: "e1" }], remove: [] },
          },
          {
            applicationId: CSV_A,
            account: { operation: "NOOP", attributeOperation: "NONE" },
            entitlements: { add: [], retain: [], remove: [] },
          },
        ]),
      ),
    ).toEqual([]);
  });

  test("duplicate delta operations collapse by itemKey", () => {
    const items = translateAccessDeltaToPlanItems(
      delta([
        {
          applicationId: AD,
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: {
            add: [
              { entitlementId: "e-vpn", name: "VPN" },
              { entitlementId: "e-vpn", name: "VPN" },
            ],
            retain: [],
            remove: [],
          },
        },
      ]),
    );
    expect(items.filter((i) => i.operationType === "ADD_ENTITLEMENT")).toHaveLength(1);
  });
});

describe("capability classification", () => {
  test("ldap_ad ADD_ACCOUNT is EXECUTABLE when config and attrs ready", () => {
    const result = classifyProvisioningOperation({
      application: adApp(),
      tenantId: TENANT,
      operationType: "ADD_ACCOUNT",
      attributes: { sAMAccountName: "alice", sn: "Example" },
      identity: identity(),
    });
    expect(result.executionClass).toBe(EXECUTION_CLASS.EXECUTABLE);
    expect(result.connectorFamily).toBe("ldap_ad");
  });

  test("missing required attribute → BLOCKED", () => {
    const result = classifyProvisioningOperation({
      application: adApp(),
      tenantId: TENANT,
      operationType: "ADD_ACCOUNT",
      attributes: {},
      identity: { _id: IDENTITY, tenantId: TENANT, email: "a@b.com" },
    });
    expect(result.executionClass).toBe(EXECUTION_CLASS.BLOCKED);
    expect(result.reasonCode).toBe(REASON_CODE.MISSING_REQUIRED_ATTRIBUTE);
    expect(result.missingAttributes?.length).toBeGreaterThan(0);
  });

  test.each(["ENABLE", "ADD_ENTITLEMENT", "REMOVE_ENTITLEMENT"])(
    "ldap_ad %s is EXECUTABLE when target context is valid",
    (operationType) => {
      const result = classifyProvisioningOperation({
        application: adApp(),
        tenantId: TENANT,
        operationType,
        entitlement: operationType.includes("ENTITLEMENT")
          ? { entitlementId: "e1", name: "VPN" }
          : undefined,
        identity: identity(),
      });
      expect(result.executionClass).toBe(EXECUTION_CLASS.EXECUTABLE);
    },
  );

  test("ldap_ad DELETE stays unsupported and malformed entitlement blocks", () => {
    expect(
      classifyProvisioningOperation({
        application: adApp(),
        tenantId: TENANT,
        operationType: "REMOVE_ACCOUNT",
      }).executionClass,
    ).toBe(EXECUTION_CLASS.UNSUPPORTED);
    const malformed = classifyProvisioningOperation({
      application: adApp(),
      tenantId: TENANT,
      operationType: "ADD_ENTITLEMENT",
      entitlement: { name: "Untrusted display name" },
    });
    expect(malformed).toMatchObject({
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.INVALID_ENTITLEMENT,
    });
  });

  test("family resolution ignores application name", () => {
    expect(
      resolveConnectorFamily({
        name: "SAP",
        connectorType: "CONNECTOR_DELIMITEDFILE",
        connectionConfig: { provisioningTestMode: "csv" },
      }),
    ).toBe("file_delimited");
    expect(
      resolveConnectorFamily({
        name: "Active Directory Fake",
        connectorType: "CONNECTOR_DELIMITEDFILE",
      }),
    ).toBe("file_delimited");
  });
});

describe("compileProvisioningPlan", () => {
  test("multi-application plan with dependency ordering", async () => {
    const plan = await compile(
      delta([
        {
          applicationId: AD,
          applicationName: "Directory",
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: {
            add: [
              { entitlementId: "e-it", name: "IT" },
              { entitlementId: "e-vpn", name: "VPN" },
            ],
            retain: [],
            remove: [{ entitlementId: "e-old", name: "Old" }],
          },
        },
        {
          applicationId: CSV_B,
          applicationName: "AppB",
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
      {
        desiredAccess: {
          applications: [
            {
              applicationId: AD,
              accountRequired: true,
              attributes: { sAMAccountName: "alice", sn: "Example" },
            },
            {
              applicationId: CSV_B,
              accountRequired: true,
              attributes: { employeeId: "E100" },
            },
          ],
        },
      },
    );

    expect(plan.applications).toHaveLength(2);
    expect(plan.metadata.connectorInvoked).toBe(false);
    expect(plan.metadata.provisioningTasksCreated).toBe(false);
    expect(plan.metadata.persisted).toBe(false);
    expect(plan.jmlCorrelationId).toBe(CORR);
    expect(plan.lifecycleEventId).toBe(EVENT);

    const ops = plan.operations.map((o) => o.operationType);
    const removeIdx = ops.indexOf("REMOVE_ENTITLEMENT");
    const addAccountIdx = ops.indexOf("ADD_ACCOUNT");
    const addEntIdx = ops.lastIndexOf("ADD_ENTITLEMENT");
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeLessThan(addAccountIdx);
    expect(addAccountIdx).toBeLessThan(addEntIdx);

    const adAdd = plan.operations.find(
      (o) => o.applicationId === AD && o.operationType === "ADD_ACCOUNT",
    );
    expect(adAdd.executionClass).toBe(EXECUTION_CLASS.EXECUTABLE);

    const entAdd = plan.operations.find((o) => o.operationType === "ADD_ENTITLEMENT");
    expect(entAdd.executionClass).toBe(EXECUTION_CLASS.EXECUTABLE);
  });

  test("RETAIN account produces no executable account task (CSV offline scenario)", async () => {
    const plan = await compile(
      delta([
        {
          applicationId: CSV_A,
          applicationName: "AppA",
          account: { operation: "RETAIN_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
        {
          applicationId: CSV_B,
          applicationName: "AppB",
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
      {
        desiredAccess: {
          applications: [
            { applicationId: CSV_A, accountRequired: true, attributes: { employeeId: "E100" } },
            { applicationId: CSV_B, accountRequired: true, attributes: { employeeId: "E100" } },
          ],
        },
        applications: [csvApp(CSV_A, "AppA"), csvApp(CSV_B, "AppB")],
      },
    );

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      applicationId: CSV_B,
      operationType: "ADD_ACCOUNT",
      executionClass: EXECUTION_CLASS.EXECUTABLE,
      connectorFamily: "file_delimited",
    });
    expect(plan.metadata.dryRun).toBe(true);
  });

  test("entitlement removal before account removal ordering", async () => {
    const plan = await compile(
      delta([
        {
          applicationId: CSV_A,
          account: { operation: "REMOVE_ACCOUNT", attributeOperation: "NONE" },
          entitlements: {
            add: [],
            retain: [],
            remove: [{ entitlementId: "e1", name: "Role" }],
          },
        },
      ]),
      { applications: [csvApp(CSV_A, "AppA")] },
    );
    expect(plan.operations.map((o) => o.operationType)).toEqual([
      "REMOVE_ENTITLEMENT",
      "REMOVE_ACCOUNT",
    ]);
  });

  test("tenant isolation rejects mismatched delta", async () => {
    await expect(
      compile(delta([], { tenantId: "other-tenant" })),
    ).rejects.toThrow(/tenant/i);
  });

  test("requires correlation and lifecycle event ids", async () => {
    await expect(
      compileProvisioningPlan({
        identity: identity(),
        accessDelta: delta([], { jmlCorrelationId: undefined }),
        context: {
          tenantId: TENANT,
          jmlCorrelationId: undefined,
          applications: [csvApp(CSV_B, "AppB")],
        },
        lifecycleEvent: {
          _id: EVENT,
          tenantId: TENANT,
          identityId: IDENTITY,
        },
      }),
    ).rejects.toThrow(/jmlCorrelationId/);

    await expect(
      compileProvisioningPlan({
        identity: identity(),
        accessDelta: delta([], { lifecycleEventId: undefined }),
        context: {
          tenantId: TENANT,
          jmlCorrelationId: CORR,
          lifecycleEventId: undefined,
          applications: [csvApp(CSV_B, "AppB")],
        },
        lifecycleEvent: {
          tenantId: TENANT,
          identityId: IDENTITY,
          jmlCorrelationId: CORR,
        },
      }),
    ).rejects.toThrow(/lifecycleEventId/);
  });

  test("secrets are stripped from attribute snapshots", async () => {
    const plan = await compile(
      delta([
        {
          applicationId: AD,
          account: {
            operation: "ADD_ACCOUNT",
            attributeOperation: "NONE",
          },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
      {
        desiredAccess: {
          applications: [
            {
              applicationId: AD,
              accountRequired: true,
              attributes: {
                sAMAccountName: "alice",
                sn: "Example",
                password: "super-secret",
              },
            },
          ],
        },
      },
    );
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("password");
  });

  test("idempotent simulation hash for identical inputs", async () => {
    const input = delta([
      {
        applicationId: CSV_B,
        account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
        entitlements: { add: [], retain: [], remove: [] },
      },
    ]);
    const a = await compile(input, {
      desiredAccess: {
        applications: [{ applicationId: CSV_B, attributes: { employeeId: "E100" } }],
      },
      applications: [csvApp(CSV_B, "AppB")],
    });
    const b = await compile(input, {
      desiredAccess: {
        applications: [{ applicationId: CSV_B, attributes: { employeeId: "E100" } }],
      },
      applications: [csvApp(CSV_B, "AppB")],
    });
    expect(a.compilationHash).toBe(b.compilationHash);
    expect(a.operations).toEqual(b.operations);
  });

  test("dry-run never marks plan as persisted", async () => {
    const plan = await compile(
      delta([
        {
          applicationId: CSV_B,
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ]),
      {
        dryRun: true,
        requestId: "64ffffffffffffffffffffff",
        desiredAccess: {
          applications: [{ applicationId: CSV_B, attributes: { employeeId: "E100" } }],
        },
        applications: [csvApp(CSV_B, "AppB")],
      },
    );
    expect(plan.metadata.persisted).toBe(false);
    expect(plan.metadata.targetWrites).toBe(false);
    expect(plan.metadata.connectorInvoked).toBe(false);
  });
});

describe("isProvisioningPlanLockedAgainstRecompile", () => {
  test("COMPILED without materialization stays mutable", () => {
    expect(
      isProvisioningPlanLockedAgainstRecompile({
        status: "COMPILED",
        metadata: { taskMaterializationDeferred: true },
      }),
    ).toBe(false);
  });

  test("EXECUTING / terminal statuses are locked", () => {
    for (const status of ["EXECUTING", "COMPLETED", "PARTIAL", "FAILED"]) {
      expect(isProvisioningPlanLockedAgainstRecompile({ status })).toBe(true);
    }
  });

  test("materialized metadata locks even if status still COMPILED", () => {
    expect(
      isProvisioningPlanLockedAgainstRecompile({
        status: "COMPILED",
        metadata: { materializedAt: new Date().toISOString(), materializedTaskCount: 2 },
      }),
    ).toBe(true);
  });
});
