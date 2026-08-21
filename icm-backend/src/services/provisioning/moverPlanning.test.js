/**
 * P7 MOVER decision/planning spine — offline deterministic coverage.
 *
 * Reuses evaluateDesiredAccess + calculateAccessDelta + compileProvisioningPlan.
 * Does NOT start workflow, create tasks, invoke connectors, or write targets.
 */

import { describe, expect, test } from "@jest/globals";
import { evaluateDesiredAccess } from "./policyDecisionService.js";
import { calculateAccessDelta } from "./accessDeltaService.js";
import {
  compileProvisioningPlan,
  translateAccessDeltaToPlanItems,
} from "./provisioningPlanCompiler.js";
import {
  classifyProvisioningOperation,
  EXECUTION_CLASS,
  REASON_CODE,
} from "./provisioningCapabilityCatalog.js";
import { collectProjectionEntitlements } from "./actualAccessService.js";
import { processLifecycleEvent } from "../lifecycle/lifecycleEventProcessor.js";

const TENANT = "64aaaaaaaaaaaaaaaaaaaaa1";
const IDENTITY = "64bbbbbbbbbbbbbbbbbbbbbb";
const EVENT = "64ffffffffffffffffffffff";
const CORR = "JML-20260816-p7-mover";
const FINANCE_APP = "64cccccccccccccccccccc01";
const IT_APP = "64cccccccccccccccccccc02";
const SHARED_APP = "64cccccccccccccccccccc03";
const ENT_FIN = "64dddddddddddddddddddd01";
const ENT_IT = "64dddddddddddddddddddd02";
const ENT_SHARED = "64dddddddddddddddddddd03";
const ENT_REMOVE = "64dddddddddddddddddddd04";

function afterIdentity(overrides = {}) {
  return {
    _id: IDENTITY,
    tenantId: TENANT,
    department: "IT",
    location: "India",
    title: "Engineer",
    manager: "MGR-IT",
    employeeId: "E100",
    email: "alice@example.com",
    firstName: "Alice",
    lastName: "Example",
    displayName: "Alice Example",
    lifecycleState: "ACTIVE",
    isActive: true,
    ...overrides,
  };
}

function csvApp(id, name) {
  return {
    _id: id,
    name,
    tenantId: TENANT,
    status: "active",
    connectorType: "CONNECTOR_DELIMITEDFILE",
    integrationType: "connector",
    connectionConfig: { provisioningTestMode: "csv" },
  };
}

function entitlement(id, name, applicationId) {
  return {
    _id: id,
    entitlementName: name,
    name,
    tenantId: TENANT,
    applicationId,
    isActive: true,
  };
}

function rule(name, department, applicationId, entitlementId, entitlementName) {
  return {
    _id: `64eeeeeeeeeeeeeeeeeeee${department === "Finance" ? "01" : "02"}`,
    tenantId: TENANT,
    name,
    enabled: true,
    priority: 10,
    conditionLogic: "AND",
    conditions: [{ field: "department", operator: "equals", value: department }],
    actions: [
      {
        type: "ENSURE_ACCOUNT",
        applicationId,
      },
      {
        type: "ENSURE_ENTITLEMENT",
        applicationId,
        entitlementIds: [entitlementId],
        entitlementNames: [entitlementName],
      },
    ],
  };
}

const BASE_INPUTS = {
  applications: [
    csvApp(FINANCE_APP, "Finance CSV App"),
    csvApp(IT_APP, "IT CSV App"),
    csvApp(SHARED_APP, "Shared CSV App"),
  ],
  entitlements: [
    entitlement(ENT_FIN, "FinanceGroup", FINANCE_APP),
    entitlement(ENT_IT, "ITGroup", IT_APP),
    entitlement(ENT_SHARED, "SharedGroup", SHARED_APP),
    entitlement(ENT_REMOVE, "LegacyGroup", IT_APP),
  ],
  roles: [],
  policies: [],
  rules: [
    rule("Finance birthright", "Finance", FINANCE_APP, ENT_FIN, "FinanceGroup"),
    rule("IT birthright", "IT", IT_APP, ENT_IT, "ITGroup"),
    {
      _id: "64eeeeeeeeeeeeeeeeeeee03",
      tenantId: TENANT,
      name: "Shared birthright",
      enabled: true,
      priority: 20,
      conditionLogic: "AND",
      conditions: [{ field: "lifecycleState", operator: "equals", value: "ACTIVE" }],
      actions: [
        { type: "ENSURE_ACCOUNT", applicationId: SHARED_APP },
        {
          type: "ENSURE_ENTITLEMENT",
          applicationId: SHARED_APP,
          entitlementIds: [ENT_SHARED],
          entitlementNames: ["SharedGroup"],
        },
      ],
    },
  ],
};

async function desiredFor(identity, inputs = BASE_INPUTS) {
  return evaluateDesiredAccess(
    identity,
    {
      tenantId: TENANT,
      lifecycleType: "MOVER",
      lifecycleEventId: EVENT,
      jmlCorrelationId: CORR,
    },
    inputs,
  );
}

function actualFromApps(apps) {
  return {
    tenantId: TENANT,
    identityId: IDENTITY,
    applications: apps,
    metadata: {
      source: "IGA_AGGREGATION_AND_CORRELATION",
      correlatedOnly: true,
      projectionEntitlementsAvailable: true,
      targetQueries: false,
      ambiguousApplicationIds: [],
      ambiguousAccounts: false,
    },
  };
}

async function planFrom(desired, actual) {
  const delta = calculateAccessDelta(desired, actual, {
    lifecycleType: "MOVER",
    lifecycleEventId: EVENT,
    jmlCorrelationId: CORR,
  });
  const plan = await compileProvisioningPlan({
    identity: afterIdentity(),
    lifecycleEvent: {
      _id: EVENT,
      tenantId: TENANT,
      identityId: IDENTITY,
      jmlCorrelationId: CORR,
      lifecycleType: "MOVER",
    },
    desiredAccess: desired,
    actualAccess: actual,
    accessDelta: delta,
    context: {
      tenantId: TENANT,
      lifecycleEventId: EVENT,
      jmlCorrelationId: CORR,
      dryRun: true,
      applications: BASE_INPUTS.applications,
      ambiguousApplicationIds: actual.metadata?.ambiguousApplicationIds,
    },
  });
  return { desired, actual, delta, plan };
}

describe("P7 MOVER AFTER-state policy + planning", () => {
  test("CASE 1: Finance → IT desired AFTER yields ADD IT and REMOVE Finance", async () => {
    const identity = afterIdentity({ department: "IT" });
    const desired = await desiredFor(identity);
    expect(desired.applications.map((a) => a.applicationId).sort()).toEqual(
      [IT_APP, SHARED_APP].sort(),
    );
    expect(desired.applications.find((a) => a.applicationId === FINANCE_APP)).toBeUndefined();

    const actual = actualFromApps([
      {
        applicationId: FINANCE_APP,
        applicationName: "Finance CSV App",
        account: { exists: true, nativeId: "alice-fin", attributes: {} },
        entitlements: [{ entitlementId: ENT_FIN, name: "FinanceGroup" }],
      },
      {
        applicationId: SHARED_APP,
        applicationName: "Shared CSV App",
        account: { exists: true, nativeId: "alice-shared", attributes: {} },
        entitlements: [{ entitlementId: ENT_SHARED, name: "SharedGroup" }],
      },
    ]);

    const { delta, plan } = await planFrom(desired, actual);
    const fin = delta.applications.find((a) => a.applicationId === FINANCE_APP);
    const it = delta.applications.find((a) => a.applicationId === IT_APP);
    const shared = delta.applications.find((a) => a.applicationId === SHARED_APP);

    expect(fin.account.operation).toBe("REMOVE_ACCOUNT");
    expect(fin.entitlements.remove.map((e) => e.entitlementId)).toContain(ENT_FIN);
    expect(it.account.operation).toBe("ADD_ACCOUNT");
    expect(it.entitlements.add.map((e) => e.entitlementId)).toContain(ENT_IT);
    expect(shared.account.operation).toBe("RETAIN_ACCOUNT");
    expect(shared.entitlements.retain.map((e) => e.entitlementId)).toContain(ENT_SHARED);

    const ops = plan.operations.map((o) => `${o.operationType}:${o.applicationId}`);
    expect(ops).toEqual(
      expect.arrayContaining([
        `REMOVE_ACCOUNT:${FINANCE_APP}`,
        `REMOVE_ENTITLEMENT:${FINANCE_APP}`,
        `ADD_ACCOUNT:${IT_APP}`,
        `ADD_ENTITLEMENT:${IT_APP}`,
      ]),
    );
    expect(ops.some((o) => o.includes(SHARED_APP))).toBe(false);
    expect(plan.metadata.connectorInvoked).toBe(false);
    expect(plan.metadata.provisioningTasksCreated).toBe(false);
    expect(plan.metadata.workflowExecuted).toBe(false);
  });

  test("CASE 2: retained shared access is RETAIN, not REMOVE", async () => {
    const desired = await desiredFor(afterIdentity({ department: "IT" }));
    const actual = actualFromApps([
      {
        applicationId: SHARED_APP,
        account: { exists: true, nativeId: "alice", attributes: {} },
        entitlements: [{ entitlementId: ENT_SHARED, name: "SharedGroup" }],
      },
      {
        applicationId: IT_APP,
        account: { exists: true, nativeId: "alice-it", attributes: {} },
        entitlements: [{ entitlementId: ENT_IT, name: "ITGroup" }],
      },
    ]);
    const { delta, plan } = await planFrom(desired, actual);
    const shared = delta.applications.find((a) => a.applicationId === SHARED_APP);
    expect(shared.account.operation).toBe("RETAIN_ACCOUNT");
    expect(shared.entitlements.retain).toHaveLength(1);
    expect(plan.operations.filter((o) => o.applicationId === SHARED_APP)).toHaveLength(0);
  });

  test("CASE 3: multi-attribute change still one consolidated desired/delta/plan", async () => {
    const identity = afterIdentity({
      department: "IT",
      location: "Singapore",
      manager: "MGR-NEW",
    });
    const desired = await desiredFor(identity);
    const actual = actualFromApps([
      {
        applicationId: FINANCE_APP,
        account: { exists: true, nativeId: "alice-fin", attributes: {} },
        entitlements: [{ entitlementId: ENT_FIN, name: "FinanceGroup" }],
      },
    ]);
    const { delta, plan } = await planFrom(desired, actual);
    expect(desired.lifecycleType).toBe("MOVER");
    expect(delta.lifecycleEventId).toBe(EVENT);
    expect(plan.lifecycleEventId).toBe(EVENT);
    expect(plan.jmlCorrelationId).toBe(CORR);
    expect(plan.totalOperations).toBeGreaterThan(0);
    // One plan document shape — not multiple plans per attribute.
    expect(Array.isArray(plan.operations)).toBe(true);
  });

  test("CASE 4: no effective access change → empty executable ops", async () => {
    const desired = await desiredFor(afterIdentity({ department: "IT", title: "Senior" }));
    const actual = actualFromApps([
      {
        applicationId: IT_APP,
        account: { exists: true, nativeId: "alice-it", attributes: {} },
        entitlements: [{ entitlementId: ENT_IT, name: "ITGroup" }],
      },
      {
        applicationId: SHARED_APP,
        account: { exists: true, nativeId: "alice-shared", attributes: {} },
        entitlements: [{ entitlementId: ENT_SHARED, name: "SharedGroup" }],
      },
    ]);
    const { delta, plan } = await planFrom(desired, actual);
    for (const app of delta.applications) {
      expect(["RETAIN_ACCOUNT", "NOOP"]).toContain(app.account.operation);
      expect(app.entitlements.add).toEqual([]);
      expect(app.entitlements.remove).toEqual([]);
    }
    expect(plan.totalOperations).toBe(0);
    expect(plan.operations).toEqual([]);
  });

  test("CASE 5: explicit REMOVE remains REMOVE and cannot become RETAIN", async () => {
    const inputs = {
      ...BASE_INPUTS,
      rules: [
        {
          _id: "64eeeeeeeeeeeeeeeeeeee99",
          tenantId: TENANT,
          name: "IT with explicit remove",
          enabled: true,
          priority: 1,
          conditionLogic: "AND",
          conditions: [{ field: "department", operator: "equals", value: "IT" }],
          actions: [
            { type: "ENSURE_ACCOUNT", applicationId: IT_APP },
            {
              type: "ENSURE_ENTITLEMENT",
              applicationId: IT_APP,
              entitlementIds: [ENT_IT, ENT_REMOVE],
              entitlementNames: ["ITGroup", "LegacyGroup"],
            },
            {
              type: "REMOVE_ENTITLEMENT",
              applicationId: IT_APP,
              entitlementIds: [ENT_REMOVE],
              entitlementNames: ["LegacyGroup"],
            },
          ],
        },
      ],
    };
    const desired = await desiredFor(afterIdentity({ department: "IT" }), inputs);
    const itDesired = desired.applications.find((a) => a.applicationId === IT_APP);
    expect(itDesired.removeEntitlements.map((e) => e.entitlementId)).toContain(ENT_REMOVE);

    const actual = actualFromApps([
      {
        applicationId: IT_APP,
        account: { exists: true, nativeId: "alice-it", attributes: {} },
        entitlements: [
          { entitlementId: ENT_IT, name: "ITGroup" },
          { entitlementId: ENT_REMOVE, name: "LegacyGroup" },
        ],
      },
    ]);
    const delta = calculateAccessDelta(desired, actual, {
      lifecycleType: "MOVER",
      lifecycleEventId: EVENT,
      jmlCorrelationId: CORR,
    });
    const ents = delta.applications.find((a) => a.applicationId === IT_APP).entitlements;
    expect(ents.remove.map((e) => e.entitlementId)).toContain(ENT_REMOVE);
    expect(ents.retain.map((e) => e.entitlementId)).not.toContain(ENT_REMOVE);
    expect(ents.add.map((e) => e.entitlementId)).not.toContain(ENT_REMOVE);
  });

  test("CASE 6: unsupported entitlement ops stay UNSUPPORTED (never fake EXECUTABLE)", async () => {
    const items = translateAccessDeltaToPlanItems(
      {
        applications: [
          {
            applicationId: IT_APP,
            account: { operation: "RETAIN_ACCOUNT", attributeOperation: "NONE" },
            entitlements: {
              add: [{ entitlementId: ENT_IT, name: "ITGroup" }],
              remove: [{ entitlementId: ENT_REMOVE, name: "LegacyGroup" }],
              retain: [],
            },
          },
        ],
      },
      null,
    );
    for (const item of items.filter((i) => i.operationType.includes("ENTITLEMENT"))) {
      const cls = classifyProvisioningOperation({
        application: csvApp(IT_APP, "IT CSV App"),
        tenantId: TENANT,
        operationType: item.operationType,
        entitlement: item.entitlement,
      });
      expect(cls.executionClass).toBe(EXECUTION_CLASS.UNSUPPORTED);
      expect(cls.reasonCode).toBe(REASON_CODE.UNSUPPORTED_OPERATION);
    }
  });

  test("CASE 7+8: multiple apps and entitlements get distinct planItemIds", async () => {
    const desired = await desiredFor(afterIdentity({ department: "IT" }));
    const actual = actualFromApps([
      {
        applicationId: FINANCE_APP,
        account: { exists: true, nativeId: "alice-fin", attributes: {} },
        entitlements: [
          { entitlementId: ENT_FIN, name: "FinanceGroup" },
          { entitlementId: "extra-fin", name: "ExtraFin" },
        ],
      },
    ]);
    const { plan } = await planFrom(desired, actual);
    const ids = plan.operations.map((o) => o.planItemId || o.itemKey);
    expect(ids.length).toBe(plan.totalOperations);
    expect(new Set(ids).size).toBe(ids.length);
    const apps = new Set(plan.operations.map((o) => o.applicationId));
    expect(apps.has(FINANCE_APP)).toBe(true);
    expect(apps.has(IT_APP)).toBe(true);
  });

  test("CASE 9: multi-account projection matches are not merged", () => {
    const projection = new Map([
      [
        `${IT_APP}:acct-a`,
        [{ entitlementId: "e1", entitlementName: "A", displayName: "A" }],
      ],
      [
        `${IT_APP}:acct-b`,
        [{ entitlementId: "e2", entitlementName: "B", displayName: "B" }],
      ],
    ]);
    expect(collectProjectionEntitlements(projection, IT_APP, ["acct-a", "acct-b"])).toEqual(
      [],
    );
  });

  test("CASE 9b: ambiguous application blocks REMOVE ops only for that app", async () => {
    const desired = {
      tenantId: TENANT,
      identityId: IDENTITY,
      lifecycleType: "MOVER",
      lifecycleEventId: EVENT,
      jmlCorrelationId: CORR,
      applications: [],
    };
    const actual = actualFromApps([
      {
        applicationId: FINANCE_APP,
        account: { exists: true, nativeId: null, attributes: {}, ambiguous: true },
        entitlements: [],
      },
    ]);
    actual.metadata.ambiguousApplicationIds = [FINANCE_APP];
    actual.metadata.ambiguousAccounts = true;

    const delta = calculateAccessDelta(desired, actual, {
      lifecycleType: "MOVER",
      lifecycleEventId: EVENT,
      jmlCorrelationId: CORR,
    });
    expect(delta.applications[0].account.operation).toBe("REMOVE_ACCOUNT");

    const plan = await compileProvisioningPlan({
      identity: afterIdentity(),
      lifecycleEvent: {
        _id: EVENT,
        tenantId: TENANT,
        identityId: IDENTITY,
        jmlCorrelationId: CORR,
      },
      desiredAccess: desired,
      actualAccess: actual,
      accessDelta: delta,
      context: {
        tenantId: TENANT,
        lifecycleEventId: EVENT,
        jmlCorrelationId: CORR,
        dryRun: true,
        applications: BASE_INPUTS.applications,
        ambiguousApplicationIds: [FINANCE_APP],
      },
    });
    const removeOp = plan.operations.find((o) => o.operationType === "REMOVE_ACCOUNT");
    expect(removeOp.executionClass).toBe(EXECUTION_CLASS.BLOCKED);
    expect(removeOp.reasonCode).toBe(REASON_CODE.ACTUAL_ACCESS_AMBIGUOUS);
  });

  test("CASE 10 + lineage: duplicate MOVER event reuses planning orchestration once", async () => {
    const calls = { generic: 0 };
    const event = {
      _id: EVENT,
      tenantId: TENANT,
      identityId: IDENTITY,
      eventType: "MOVER",
      lifecycleType: "MOVER",
      jmlCorrelationId: CORR,
      metadata: {},
    };
    const sharedResult = {
      success: true,
      planningOnly: true,
      provisioningRequestId: "req-1",
      planId: "plan-1",
      workflowExecutionId: null,
      totalOperations: 2,
      jmlCorrelationId: CORR,
      reused: false,
    };

    const deps = {
      isGenericMoverOrchestrationEnabled: () => true,
      findBlockingHigherPriorityEvent: async () => null,
      loadIdentityForEvent: async () => afterIdentity(),
      startGenericPlanOrchestration: async (args) => {
        calls.generic += 1;
        expect(args.context.planningOnly).toBe(true);
        expect(args.context.lifecycleType).toBe("MOVER");
        expect(args.context.jmlCorrelationId).toBe(CORR);
        if (calls.generic > 1) {
          return { ...sharedResult, reused: true };
        }
        return sharedResult;
      },
      markLifecycleEventCompleted: async () => ({}),
      markLifecycleEventFailed: async () => ({}),
    };

    const first = await processLifecycleEvent(event, deps);
    const second = await processLifecycleEvent(event, deps);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls.generic).toBe(2);
    expect(first.result.provisioningRequestId).toBe("req-1");
    expect(second.result.provisioningRequestId).toBe("req-1");
    expect(first.result.planId).toBe("plan-1");
    expect(second.result.planId).toBe("plan-1");
    expect(first.result.workflowExecutionId).toBeNull();
    expect(second.result.reused).toBe(true);
  });

  test("tenant mismatch fails planning before side effects", async () => {
    await expect(
      evaluateDesiredAccess(
        afterIdentity({ tenantId: "64ffffffffffffffffffffff" }),
        { tenantId: TENANT, lifecycleType: "MOVER" },
        BASE_INPUTS,
      ),
    ).rejects.toThrow(/tenantId/i);
  });

  test("side-effect audit: planning route never starts workflow via processor", async () => {
    let workflowStarted = false;
    const result = await processLifecycleEvent(
      {
        _id: EVENT,
        tenantId: TENANT,
        identityId: IDENTITY,
        eventType: "MOVER",
        lifecycleType: "MOVER",
        jmlCorrelationId: CORR,
        metadata: {},
      },
      {
        isGenericMoverOrchestrationEnabled: () => true,
        findBlockingHigherPriorityEvent: async () => null,
        loadIdentityForEvent: async () => afterIdentity(),
        startGenericPlanOrchestration: async (args) => {
          expect(args.context.planningOnly).toBe(true);
          // Simulate planning-only service contract: no execution id.
          return {
            success: true,
            planningOnly: true,
            provisioningRequestId: "req-x",
            planId: "plan-x",
            workflowExecutionId: null,
            totalOperations: 0,
            jmlCorrelationId: CORR,
          };
        },
        startLeaverProvisioningFromEvent: async () => {
          workflowStarted = true;
          return {};
        },
        markLifecycleEventCompleted: async () => ({}),
        markLifecycleEventFailed: async () => ({}),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.result.planningOnly).toBe(true);
    expect(result.result.workflowExecutionId).toBeNull();
    expect(workflowStarted).toBe(false);
  });
});
