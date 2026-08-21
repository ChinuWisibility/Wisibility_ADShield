import { describe, expect, test } from "@jest/globals";
import { evaluateDesiredAccess, desiredAccessToEnsureAccountActions } from "./policyDecisionService.js";

const TENANT_A = "64b000000000000000000001";
const TENANT_B = "64b000000000000000000002";
const IDENTITY = {
  _id: "64b000000000000000000010",
  tenantId: TENANT_A,
  department: "IT",
  location: "India",
  lifecycleState: "ACTIVE",
  isActive: true,
  firstName: "Dipankar",
  lastName: "Karmakar",
  employeeId: "EMP001",
};
const AD = { _id: "64b000000000000000000101", tenantId: TENANT_A, name: "AD", status: "active" };
const M365 = { _id: "64b000000000000000000102", tenantId: TENANT_A, name: "M365", status: "active" };
const IT = {
  _id: "64b000000000000000000201",
  tenantId: TENANT_A,
  applicationId: AD._id,
  entitlementName: "IT",
  isActive: true,
};
const VPN = {
  _id: "64b000000000000000000202",
  tenantId: TENANT_A,
  applicationId: AD._id,
  entitlementName: "VPN-USERS",
  isActive: true,
};

function rule(overrides = {}) {
  return {
    _id: "64b000000000000000000301",
    tenantId: TENANT_A,
    name: "IT India Birthright",
    enabled: true,
    priority: 10,
    conditionLogic: "AND",
    conditions: [
      { field: "department", operator: "equals", value: "IT" },
      { field: "location", operator: "equals", value: "India" },
    ],
    actions: [{ type: "ENSURE_ACCOUNT", applicationId: AD._id }],
    ...overrides,
  };
}

function inputs(overrides = {}) {
  return {
    rules: [rule()],
    policies: [],
    applications: [AD, M365],
    entitlements: [IT, VPN],
    roles: [],
    ...overrides,
  };
}

async function evaluate(identity = IDENTITY, context = {}, input = inputs()) {
  return evaluateDesiredAccess(
    identity,
    { tenantId: TENANT_A, lifecycleType: "JOINER", ...context },
    input,
  );
}

describe("Policy Decision / Desired Access Engine", () => {
  test("matching ENSURE_ACCOUNT rule produces a desired account", async () => {
    const result = await evaluate();
    expect(result.applications).toEqual([
      expect.objectContaining({
        applicationId: AD._id,
        applicationName: "AD",
        accountRequired: true,
      }),
    ]);
    expect(result.metadata.targetWrites).toBe(false);
    expect(result.metadata.provisioningTasksCreated).toBe(false);
  });

  test("non-matching rule produces no desired access", async () => {
    const result = await evaluate({ ...IDENTITY, department: "HR" });
    expect(result.applications).toEqual([]);
    expect(result.matchedRules).toEqual([]);
  });

  test("multiple matching rules select multiple applications", async () => {
    const result = await evaluate(
      IDENTITY,
      {},
      inputs({
        rules: [
          rule(),
          rule({
            _id: "64b000000000000000000302",
            name: "M365 Birthright",
            priority: 20,
            actions: [{ type: "ENSURE_ACCOUNT", applicationId: M365._id }],
          }),
        ],
      }),
    );
    expect(result.applications.map((app) => app.applicationName)).toEqual(["AD", "M365"]);
  });

  test("entitlements are resolved, deduplicated, and deterministically ordered", async () => {
    const result = await evaluate(
      IDENTITY,
      {},
      inputs({
        rules: [
          rule({
            actions: [
              {
                type: "ENSURE_ENTITLEMENT",
                applicationId: AD._id,
                entitlementIds: [VPN._id, IT._id, VPN._id],
              },
              {
                type: "ENSURE_ENTITLEMENT",
                applicationId: AD._id,
                entitlementNames: ["IT", "VPN-USERS"],
              },
              { type: "ENSURE_ACCOUNT", applicationId: AD._id },
            ],
          }),
        ],
      }),
    );
    expect(result.applications[0].entitlements.map((e) => e.name)).toEqual(["IT", "VPN-USERS"]);
  });

  test("priority makes account attribute conflict resolution deterministic", async () => {
    const result = await evaluate(
      IDENTITY,
      {},
      inputs({
        rules: [
          rule({
            priority: 10,
            actions: [{ type: "ENSURE_ACCOUNT", applicationId: AD._id, attributes: { department: "IT" } }],
          }),
          rule({
            _id: "64b000000000000000000303",
            priority: 20,
            name: "Lower priority conflicting attribute",
            actions: [{ type: "ENSURE_ACCOUNT", applicationId: AD._id, attributes: { department: "Other" } }],
          }),
        ],
      }),
    );
    expect(result.applications[0].attributes).toEqual({ department: "IT" });
  });

  test("disabled rules are ignored", async () => {
    const result = await evaluate(IDENTITY, {}, inputs({ rules: [rule({ enabled: false })] }));
    expect(result.applications).toEqual([]);
  });

  test.each(["JOINER", "MOVER", "LEAVER", "REHIRE"])(
    "accepts lifecycle context %s without target execution",
    async (lifecycleType) => {
      const result = await evaluate(IDENTITY, { lifecycleType });
      expect(result.lifecycleType).toBe(lifecycleType);
      expect(result.metadata.actualAccessRead).toBe(false);
      expect(result.metadata.targetWrites).toBe(false);
    },
  );

  test("LEAVER does not inherit JOINER birthright; explicit LEAVER policy can disable", async () => {
    const result = await evaluate(
      IDENTITY,
      { lifecycleType: "LEAVER" },
      inputs({
        policies: [
          {
            _id: "64b000000000000000000405",
            tenantId: TENANT_A,
            policyName: "Disable leaver AD account",
            isActive: true,
            triggerEvent: "LEAVER",
            actions: [{ type: "DISABLE_ACCOUNT", applicationId: AD._id }],
          },
        ],
      }),
    );
    expect(result.matchedRules).toEqual([]);
    expect(result.applications).toEqual([
      expect.objectContaining({ applicationId: AD._id, accountRequired: false, accountDisabled: true }),
    ]);
  });

  test("ProvisioningPolicy contributes desired multi-application birthright state", async () => {
    const result = await evaluate(
      IDENTITY,
      {},
      inputs({
        rules: [],
        policies: [
          {
            _id: "64b000000000000000000401",
            tenantId: TENANT_A,
            policyName: "Employee birthright",
            isActive: true,
            priority: 10,
            triggerEvent: "JOINER",
            actions: [
              {
                type: "ENSURE_ACCOUNT",
                applicationId: M365._id,
                attributes: { employeeId: "EMP001" },
              },
              {
                type: "ENSURE_ENTITLEMENT",
                applicationId: AD._id,
                entitlementNames: ["IT", "VPN-USERS"],
              },
            ],
          },
        ],
      }),
    );
    expect(result.applications.map((app) => app.applicationName)).toEqual(["AD", "M365"]);
    expect(result.applications.find((app) => app.applicationName === "AD").entitlements).toHaveLength(2);
    expect(result.applications.find((app) => app.applicationName === "M365").attributes).toEqual({
      employeeId: "EMP001",
    });
    expect(result.matchedPolicies.map((policy) => policy.policyName)).toEqual(["Employee birthright"]);
  });

  test("tenant isolation rejects other tenant application and rules", async () => {
    const result = await evaluate(
      IDENTITY,
      {},
      inputs({
        rules: [
          rule({ tenantId: TENANT_B }),
          rule({ actions: [{ type: "ENSURE_ACCOUNT", applicationId: "64b000000000000000000199" }] }),
        ],
        applications: [
          AD,
          { _id: "64b000000000000000000199", tenantId: TENANT_B, name: "Other tenant", status: "active" },
        ],
      }),
    );
    expect(result.applications).toEqual([]);
  });

  test("same identity/policy/context produces identical desired state", async () => {
    const one = await evaluate();
    const two = await evaluate();
    expect(one).toEqual(two);
  });

  test("compatibility adapter returns existing ENSURE_ACCOUNT shape only", async () => {
    const result = await evaluate(
      IDENTITY,
      {},
      inputs({
        rules: [
          rule({
            actions: [
              { type: "ENSURE_ACCOUNT", applicationId: AD._id },
              { type: "DISABLE_ACCOUNT", applicationId: M365._id },
            ],
          }),
        ],
      }),
    );
    expect(desiredAccessToEnsureAccountActions(result)).toEqual([
      expect.objectContaining({ applicationId: AD._id, applicationName: "AD" }),
    ]);
  });

  test("policy result does not expose sensitive identity input", async () => {
    const result = await evaluate({ ...IDENTITY, password: "not-in-result", attributes: { token: "nope" } });
    expect(JSON.stringify(result)).not.toContain("not-in-result");
    expect(JSON.stringify(result)).not.toContain("nope");
  });
});

