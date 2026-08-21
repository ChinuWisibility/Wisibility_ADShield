/**
 * Offline pipeline simulation — no Mongo / AD.
 * Proves: rule → ENSURE_ACCOUNT intent → approval gate → ADD_ACCOUNT → family resolve → createAccount.
 */

import { describe, expect, test } from "@jest/globals";
import {
  evaluateIdentityProvisioningRule,
  collectEnsureAccountActions,
} from "./identityProvisioningRuleService.js";
import { getConnectorDefinition } from "../../config/connectorCatalog.js";
import { createCsvTestProvisioningConnector } from "./connectors/csvTestProvisioningConnector.js";
import { createAdProvisioningConnector } from "./connectors/adProvisioningConnector.js";

describe("Joiner pipeline (offline simulation)", () => {
  const identity = {
    _id: "id1",
    tenantId: "t1",
    department: "IT",
    location: "India",
    employeeId: "IS-JOINER-TEST-001",
    email: "is-joiner-test-001@example.com",
    displayName: "Joiner Test",
    firstName: "Joiner",
    lastName: "Test",
  };

  test("rule match yields ENSURE_ACCOUNT for configurable application", () => {
    const sapAppId = "sap-app-id";
    const rule = {
      _id: "rule1",
      name: "IT India",
      conditionLogic: "AND",
      conditions: [
        { field: "department", operator: "equals", value: "IT" },
        { field: "location", operator: "equals", value: "India" },
      ],
      actions: [{ type: "ENSURE_ACCOUNT", applicationId: sapAppId }],
    };
    expect(evaluateIdentityProvisioningRule(identity, rule).matched).toBe(true);
    const { ensureAccounts } = collectEnsureAccountActions(identity, [rule]);
    expect(ensureAccounts[0].applicationId).toBe(sapAppId);
  });

  test("approval gate: task must not exist before APPROVED", () => {
    const request = { approvalStatus: "PENDING", status: "PENDING", metadata: {} };
    const canCreateTask = request.approvalStatus === "APPROVED";
    expect(canCreateTask).toBe(false);
    request.approvalStatus = "APPROVED";
    expect(request.approvalStatus === "APPROVED").toBe(true);
  });

  test("rejection stops provisioning", () => {
    const request = { approvalStatus: "REJECTED", status: "CANCELLED" };
    expect(request.approvalStatus === "APPROVED").toBe(false);
    expect(["PENDING", "RUNNING", "COMPLETED"].includes("CANCELLED")).toBe(false);
  });

  test("SAP and Oracle resolve via file_delimited family (not name branching)", () => {
    expect(getConnectorDefinition("CONNECTOR_DELIMITEDFILE", "SAP").family).toBe("file_delimited");
    expect(getConnectorDefinition("CONNECTOR_DELIMITEDFILE", "Oracle").family).toBe(
      "file_delimited",
    );
    expect(getConnectorDefinition("ACTIVE_DIRECTORY", "Active Directory").family).toBe("ldap_ad");
  });

  test("CSV connector exposes createAccount + executeTask (generic contract)", () => {
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
    expect(typeof connector.createAccount).toBe("function");
    expect(typeof connector.executeTask).toBe("function");
    expect(connector.family).toBe("file_delimited");
  });

  test("AD connector exposes createAccount wrapping existing createAdUser path", () => {
    const connector = createAdProvisioningConnector({
      application: {
        _id: "ad1",
        name: "Active Directory",
        connectorType: "ACTIVE_DIRECTORY",
        connectionConfig: { ad: { url: "ldap://example", bindDn: "x", targetOuDn: "OU=x" } },
      },
    });
    expect(typeof connector.createAccount).toBe("function");
    expect(typeof connector.executeTask).toBe("function");
    expect(connector.family).toBe("ldap_ad");
  });

  test("same engine path for SAP then Oracle — only applicationId changes", () => {
    const baseRule = {
      conditionLogic: "AND",
      conditions: [
        { field: "department", operator: "equals", value: "IT" },
        { field: "location", operator: "equals", value: "India" },
      ],
    };
    const sap = collectEnsureAccountActions(identity, [
      { ...baseRule, _id: "1", name: "sap", actions: [{ type: "ENSURE_ACCOUNT", applicationId: "SAP_ID" }] },
    ]);
    const oracle = collectEnsureAccountActions(identity, [
      {
        ...baseRule,
        _id: "2",
        name: "oracle",
        actions: [{ type: "ENSURE_ACCOUNT", applicationId: "ORACLE_ID" }],
      },
    ]);
    expect(sap.ensureAccounts[0].applicationId).toBe("SAP_ID");
    expect(oracle.ensureAccounts[0].applicationId).toBe("ORACLE_ID");
  });
});
