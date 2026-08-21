/**
 * AD readiness check (offline): family resolution + connector wires to createAccount.
 * Does NOT claim live LDAP success.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { getConnectorDefinition } from "../../../config/connectorCatalog.js";
import { createAdProvisioningConnector } from "./adProvisioningConnector.js";

describe("AD provisioning wiring (offline)", () => {
  const tenantId = "64aaaaaaaaaaaaaaaaaaaaa1";
  const applicationId = "64bbbbbbbbbbbbbbbbbbbbbb";

  function application() {
    return {
      _id: applicationId,
      tenantId,
      name: "Directory",
      connectorType: "ACTIVE_DIRECTORY",
      connectionConfig: {
        ad: {
          url: "ldap://dc.example.com",
          bindDn: "CN=bind,DC=example,DC=com",
          bindPassword: "x",
          targetOuDn: "OU=Users,DC=example,DC=com",
          groupWriteBaseDn: "OU=Groups,DC=example,DC=com",
          baseDn: "DC=example,DC=com",
        },
      },
    };
  }

  function task(operationType, targetAttributes = {}) {
    return {
      _id: "task-1",
      requestId: "request-1",
      applicationId,
      operationType,
      targetAttributes: {
        tenantId,
        identityId: "64cccccccccccccccccccccc",
        nativeIdentifier: "00112233-4455-6677-8899-AABBCCDDEEFF",
        attributes: {},
        ...targetAttributes,
      },
    };
  }

  test("ACTIVE_DIRECTORY family is ldap_ad", () => {
    expect(getConnectorDefinition("ACTIVE_DIRECTORY").family).toBe("ldap_ad");
  });

  test("AD connector createAccount fails clearly without identity (no LDAP call claimed)", async () => {
    const connector = createAdProvisioningConnector({
      application: {
        _id: "ad1",
        name: "Active Directory",
        connectorType: "ACTIVE_DIRECTORY",
        connectionConfig: {
          ad: {
            url: "ldap://192.168.68.107",
            bindDn: "CN=bind,DC=example,DC=com",
            bindPassword: "x",
            targetOuDn: "OU=Users,DC=example,DC=com",
            baseDn: "DC=example,DC=com",
          },
        },
      },
    });
    const result = await connector.createAccount({
      tenantId: null,
      identityId: null,
    });
    expect(result.status).toBe("FAILED");
    expect(result.message).toMatch(/tenantId and identityId/i);
  });

  test("dispatches ENABLE through injected LDAP adapter", async () => {
    const enableAdUser = jest.fn().mockResolvedValue({
      enabled: true,
      noop: false,
      dn: "CN=Alice,OU=Users,DC=example,DC=com",
      objectGUID: "00112233-4455-6677-8899-AABBCCDDEEFF",
    });
    const connector = createAdProvisioningConnector({
      application: application(),
      ldapService: { enableAdUser },
    });
    const result = await connector.executeTask(task("ENABLE"));
    expect(result.status).toBe("COMPLETED");
    expect(enableAdUser).toHaveBeenCalledWith(
      application().connectionConfig.ad,
      expect.objectContaining({
        nativeIdentifier: "00112233-4455-6677-8899-AABBCCDDEEFF",
      }),
    );
  });

  test.each([
    ["ADD_ENTITLEMENT", "addAdGroupMember"],
    ["REMOVE_ENTITLEMENT", "removeAdGroupMember"],
  ])("dispatches %s through catalog target resolution", async (operation, method) => {
    const writer = jest.fn().mockResolvedValue({
      changed: true,
      userDn: "CN=Alice,OU=Users,DC=example,DC=com",
      groupDn: "CN=VPN,OU=Groups,DC=example,DC=com",
    });
    const ldapService = { [method]: writer };
    const entitlementTargetResolver = jest.fn().mockResolvedValue({
      catalogId: "64dddddddddddddddddddddd",
      objectSid: "S-1-5-21-100",
      groupDn: "CN=VPN,OU=Groups,DC=example,DC=com",
    });
    const connector = createAdProvisioningConnector({
      application: application(),
      ldapService,
      entitlementTargetResolver,
    });
    const entitlement = { entitlementId: "64dddddddddddddddddddddd" };
    const result = await connector.executeTask(
      task(operation, { entitlement }),
    );
    expect(result.status).toBe("COMPLETED");
    expect(entitlementTargetResolver).toHaveBeenCalledWith({
      tenantId,
      application: application(),
      entitlement,
    });
    expect(writer).toHaveBeenCalledWith(
      application().connectionConfig.ad,
      expect.objectContaining({
        groupDn: "CN=VPN,OU=Groups,DC=example,DC=com",
      }),
    );
  });

  test("blocks tenant mismatch before any LDAP call", async () => {
    const enableAdUser = jest.fn();
    const connector = createAdProvisioningConnector({
      application: application(),
      ldapService: { enableAdUser },
    });
    const result = await connector.executeTask(
      task("ENABLE", { tenantId: "64eeeeeeeeeeeeeeeeeeeeee" }),
    );
    expect(result.status).toBe("FAILED");
    expect(result.detail).toMatchObject({
      blocked: true,
      code: "TENANT_MISMATCH",
    });
    expect(enableAdUser).not.toHaveBeenCalled();
  });

  test("keeps REMOVE_ACCOUNT unsupported and performs no LDAP write", async () => {
    const ldapService = {
      enableAdUser: jest.fn(),
      addAdGroupMember: jest.fn(),
      removeAdGroupMember: jest.fn(),
    };
    const connector = createAdProvisioningConnector({
      application: application(),
      ldapService,
    });
    const result = await connector.executeTask(task("REMOVE_ACCOUNT"));
    expect(result.status).toBe("FAILED");
    expect(result.message).toMatch(/does not support/i);
    expect(Object.values(ldapService).every((fn) => fn.mock.calls.length === 0)).toBe(
      true,
    );
  });

  test("returns structured failure and redacts connector error secrets", async () => {
    const enableAdUser = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("password=hunter2 bindPassword=bind-secret"), {
          code: "AD_SCOPE_VIOLATION",
        }),
      );
    const connector = createAdProvisioningConnector({
      application: application(),
      ldapService: { enableAdUser },
    });
    const result = await connector.executeTask(task("ENABLE"));
    expect(result.status).toBe("FAILED");
    expect(result.message).not.toContain("hunter2");
    expect(result.message).not.toContain("bind-secret");
    expect(result.detail).toMatchObject({
      blocked: true,
      code: "AD_SCOPE_VIOLATION",
    });
  });
});
