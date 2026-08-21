import { describe, expect, test } from "@jest/globals";
import {
  evaluateIdentityProvisioningRule,
  collectEnsureAccountActions,
} from "./identityProvisioningRuleService.js";
import { buildJoinerSourceId } from "./joinerProvisioningService.js";
import { provisioningResult, sanitizeConnectorDetail } from "./connectors/provisioningConnectorContract.js";

describe("identityProvisioningRuleService", () => {
  const identity = {
    department: "IT",
    location: "India",
    employeeId: "IS-JOINER-TEST-001",
    email: "joiner.test@example.com",
  };

  test("matches department AND location", () => {
    const rule = {
      _id: "r1",
      name: "IT India AD",
      conditionLogic: "AND",
      conditions: [
        { field: "department", operator: "equals", value: "IT" },
        { field: "location", operator: "equals", value: "India" },
      ],
      actions: [{ type: "ENSURE_ACCOUNT", applicationId: "app1" }],
    };
    const { matched } = evaluateIdentityProvisioningRule(identity, rule);
    expect(matched).toBe(true);
  });

  test("mismatch does not match", () => {
    const rule = {
      conditionLogic: "AND",
      conditions: [
        { field: "department", operator: "equals", value: "IT" },
        { field: "location", operator: "equals", value: "US" },
      ],
      actions: [{ type: "ENSURE_ACCOUNT", applicationId: "app1" }],
    };
    expect(evaluateIdentityProvisioningRule(identity, rule).matched).toBe(false);
  });

  test("collectEnsureAccountActions dedupes applications", () => {
    const rules = [
      {
        _id: "r1",
        name: "A",
        conditionLogic: "AND",
        conditions: [{ field: "department", operator: "equals", value: "IT" }],
        actions: [
          { type: "ENSURE_ACCOUNT", applicationId: "app1" },
          { type: "ENSURE_ACCOUNT", applicationId: "app1" },
        ],
      },
      {
        _id: "r2",
        name: "B",
        conditionLogic: "AND",
        conditions: [{ field: "location", operator: "equals", value: "India" }],
        actions: [{ type: "ENSURE_ACCOUNT", applicationId: "app2" }],
      },
    ];
    const { ensureAccounts } = collectEnsureAccountActions(identity, rules);
    expect(ensureAccounts).toHaveLength(2);
    expect(ensureAccounts.map((a) => String(a.applicationId)).sort()).toEqual(["app1", "app2"]);
  });

  test("disabled-style empty conditions do not match", () => {
    expect(evaluateIdentityProvisioningRule(identity, { conditions: [] }).matched).toBe(false);
  });
});

describe("joiner idempotency key", () => {
  test("buildJoinerSourceId is deterministic", () => {
    expect(buildJoinerSourceId({ syncJobId: "s1", identityId: "i1", applicationId: "a1" })).toBe(
      "joiner:s1:i1:a1",
    );
  });
});

describe("provisioningConnectorContract", () => {
  test("sanitize strips secrets", () => {
    const d = sanitizeConnectorDetail({
      dn: "CN=x",
      password: "secret",
      bindPassword: "x",
      nested: { unicodePwd: "nope", ok: 1 },
    });
    expect(d.password).toBeUndefined();
    expect(d.bindPassword).toBeUndefined();
    expect(d.nested.unicodePwd).toBeUndefined();
    expect(d.nested.ok).toBe(1);
    expect(d.dn).toBe("CN=x");
  });

  test("provisioningResult normalizes status", () => {
    expect(provisioningResult({ status: "completed" }).status).toBe("COMPLETED");
    expect(provisioningResult({ status: "wat" }).status).toBe("FAILED");
  });
});
