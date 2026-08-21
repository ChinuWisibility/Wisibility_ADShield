/**
 * Lifecycle detection + CREATE/UPDATE/DISABLE offline tests (no Mongo / AD).
 */

import { describe, expect, test } from "@jest/globals";
import {
  detectIdentityLifecycleChanges,
  fingerprintChanges,
  buildLifecycleIdempotencyKey,
} from "../lifecycle/lifecycleDetectionService.js";
import { createJmlCorrelationId, isJmlCorrelationId } from "../lifecycle/jmlCorrelation.js";
import { buildAccountAttributePatchFromIdentity } from "./lifecycleProvisioningService.js";
import {
  evaluateIdentityProvisioningRule,
  collectEnsureAccountActions,
} from "./identityProvisioningRuleService.js";
import {
  normalizeProvisioningOperation,
  PROVISIONING_OPERATION,
} from "./connectors/provisioningConnectorContract.js";
import { createAdProvisioningConnector } from "./connectors/adProvisioningConnector.js";
import { createCsvTestProvisioningConnector } from "./connectors/csvTestProvisioningConnector.js";

describe("Lifecycle detection", () => {
  test("no event when nothing changed", () => {
    const identity = {
      department: "IT",
      title: "Engineer",
      lifecycleState: "ACTIVE",
    };
    const result = detectIdentityLifecycleChanges(identity, { ...identity });
    expect(result.changed).toBe(false);
    expect(result.lifecycleEvents).toEqual([]);
    expect(result.attributeEvents).toEqual([]);
  });

  test("IDENTITY_CREATED + JOINER for insert", () => {
    const after = {
      department: "IT",
      location: "India",
      lifecycleState: "ACTIVE",
      displayName: "New Hire",
    };
    const result = detectIdentityLifecycleChanges(null, after);
    expect(result.changed).toBe(true);
    expect(result.attributeEvents).toContain("IDENTITY_CREATED");
    expect(result.lifecycleEvents).toContain("JOINER");
  });

  test("department change yields DEPARTMENT_CHANGED + MOVER", () => {
    const before = {
      department: "Finance",
      title: "Analyst",
      manager: "MGR001",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = {
      department: "IT",
      title: "Analyst",
      manager: "MGR001",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("DEPARTMENT_CHANGED");
    expect(result.attributeEvents).toContain("IDENTITY_UPDATED");
    expect(result.lifecycleEvents).toContain("MOVER");
    expect(result.lifecycleEvents).not.toContain("LEAVER");
  });

  test("title + manager change yields mover signals", () => {
    const before = {
      department: "IT",
      title: "Analyst",
      manager: "MGR001",
      lifecycleState: "ACTIVE",
    };
    const after = {
      department: "IT",
      title: "Senior Analyst",
      manager: "MGR009",
      lifecycleState: "ACTIVE",
    };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.attributeEvents).toContain("TITLE_CHANGED");
    expect(result.attributeEvents).toContain("MANAGER_CHANGED");
    expect(result.lifecycleEvents).toContain("MOVER");
  });

  test("immediate termination yields TERMINATION_EFFECTIVE + LEAVER", () => {
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

  test("future termination yields TERMINATION_SCHEDULED without LEAVER primary", () => {
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

  test("rehire from TERMINATED to ACTIVE", () => {
    const before = { lifecycleState: "TERMINATED", isActive: false, department: "IT" };
    const after = { lifecycleState: "ACTIVE", isActive: true, department: "IT" };
    const result = detectIdentityLifecycleChanges(before, after);
    expect(result.lifecycleEvents).toContain("REHIRE");
  });

  test("idempotency key is sync-scoped and stable for same fingerprint", () => {
    const changes = [
      { field: "department", before: "A", after: "B" },
      { field: "title", before: "X", after: "Y" },
    ];
    const fp1 = fingerprintChanges(changes);
    const fp2 = fingerprintChanges([...changes].reverse());
    expect(fp1).toBe(fp2);
    const key = buildLifecycleIdempotencyKey({
      tenantId: "t1",
      identityId: "i1",
      eventType: "MOVER",
      syncJobId: "sync-abc",
      changeFingerprint: fp1,
    });
    expect(key).toContain("MOVER");
    expect(key).toContain("t1");
    expect(key).toContain("sync-abc");
  });
});

describe("JML correlation id", () => {
  test("creates valid correlation id", () => {
    const id = createJmlCorrelationId(new Date("2026-08-16T10:00:00Z"));
    expect(id.startsWith("JML-20260816-")).toBe(true);
    expect(isJmlCorrelationId(id)).toBe(true);
  });
});

describe("Policy + operation aliases", () => {
  test("CREATE_ACCOUNT aliases to ADD_ACCOUNT", () => {
    expect(normalizeProvisioningOperation("CREATE_ACCOUNT")).toBe("ADD_ACCOUNT");
    expect(normalizeProvisioningOperation("DISABLE_ACCOUNT")).toBe("DISABLE");
    expect(PROVISIONING_OPERATION.CREATE_ACCOUNT).toBe("ADD_ACCOUNT");
    expect(PROVISIONING_OPERATION.DISABLE_ACCOUNT).toBe("DISABLE");
  });

  test("matching joiner rule yields ENSURE_ACCOUNT", () => {
    const identity = { department: "IT", location: "India" };
    const rule = {
      _id: "r1",
      name: "IT India",
      conditionLogic: "AND",
      conditions: [
        { field: "department", operator: "equals", value: "IT" },
        { field: "location", operator: "equals", value: "India" },
      ],
      actions: [{ type: "ENSURE_ACCOUNT", applicationId: "app1" }],
    };
    expect(evaluateIdentityProvisioningRule(identity, rule).matched).toBe(true);
    expect(collectEnsureAccountActions(identity, [rule]).ensureAccounts).toHaveLength(1);
  });

  test("non-matching rule yields no ENSURE_ACCOUNT", () => {
    const identity = { department: "HR", location: "India" };
    const rule = {
      _id: "r1",
      name: "IT India",
      conditionLogic: "AND",
      conditions: [
        { field: "department", operator: "equals", value: "IT" },
        { field: "location", operator: "equals", value: "India" },
      ],
      actions: [{ type: "ENSURE_ACCOUNT", applicationId: "app1" }],
    };
    expect(evaluateIdentityProvisioningRule(identity, rule).matched).toBe(false);
  });
});

describe("UPDATE attribute patch", () => {
  test("builds allowlisted AD-oriented attribute map from mover changes", () => {
    const identity = {
      displayName: "Ravi Kumar",
      firstName: "Ravi",
      lastName: "Kumar",
      department: "IT",
      title: "Senior Analyst",
      email: "ravi@example.com",
      employeeId: "EMP1",
    };
    const changeSet = {
      changes: [
        { field: "department", before: "Finance", after: "IT" },
        { field: "title", before: "Analyst", after: "Senior Analyst" },
      ],
    };
    const patch = buildAccountAttributePatchFromIdentity(identity, changeSet);
    expect(patch.department).toBe("IT");
    expect(patch.title).toBe("Senior Analyst");
    expect(patch.displayName).toBeUndefined();
  });
});

describe("Connector contracts CREATE/UPDATE/DISABLE", () => {
  test("AD connector exposes create/update/disable + executeTask", () => {
    const connector = createAdProvisioningConnector({
      application: {
        _id: "ad1",
        name: "Active Directory",
        connectorType: "ACTIVE_DIRECTORY",
        connectionConfig: { ad: { url: "ldap://example", bindDn: "x", targetOuDn: "OU=x" } },
      },
    });
    expect(typeof connector.createAccount).toBe("function");
    expect(typeof connector.updateAccount).toBe("function");
    expect(typeof connector.disableAccount).toBe("function");
    expect(typeof connector.executeTask).toBe("function");
  });

  test("CSV connector supports UPDATE and DISABLE ops in executeTask switch", () => {
    const connector = createCsvTestProvisioningConnector({
      application: {
        _id: "a1",
        name: "SAP",
        tenantId: "t1",
        connectorType: "CONNECTOR_DELIMITEDFILE",
        userMappings: [
          { csvColumn: "employee_id", standardField: "employee_id", isPrimaryKey: true },
        ],
      },
    });
    expect(typeof connector.updateAccount).toBe("function");
    expect(typeof connector.disableAccount).toBe("function");
  });
});

describe("Lifecycle priority ordering", () => {
  test("LEAVER priority greater than MOVER greater than JOINER", async () => {
    const { LIFECYCLE_PRIORITY } = await import("../../models/identity/LifecycleEvent.js");
    expect(LIFECYCLE_PRIORITY.LEAVER).toBeGreaterThan(LIFECYCLE_PRIORITY.MOVER);
    expect(LIFECYCLE_PRIORITY.MOVER).toBeGreaterThan(LIFECYCLE_PRIORITY.JOINER);
  });
});
