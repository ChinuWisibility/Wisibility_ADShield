import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let ldapClient;

class MockAttribute {
  constructor(input) {
    Object.assign(this, input);
  }
}
class MockChange {
  constructor(input) {
    Object.assign(this, input);
  }
}

jest.unstable_mockModule("ldapts", () => ({
  Client: class {
    constructor() {
      return ldapClient;
    }
  },
  Attribute: MockAttribute,
  Change: MockChange,
  PagedResultsControl: class {},
}));

const {
  addAdGroupMember,
  assertDnWithinScope,
  createAdUser,
  disableAdUser,
  enableAdUser,
  normalizeAdConfig,
  objectGuidToLdapFilterValue,
  removeAdGroupMember,
  resolveAdUserTarget,
  updateAdUser,
  wrapLdapError,
} = await import("./adLdapService.js");

const USER_DN = "CN=Alice,OU=Users,DC=example,DC=com";
const OUTSIDE_DN = "CN=Alice,OU=Admins,DC=example,DC=com";
const GROUP_DN = "CN=VPN,OU=Groups,DC=example,DC=com";
const GUID = "00112233-4455-6677-8899-AABBCCDDEEFF";

const cfg = {
  url: "ldap://dc.example.com",
  bindDn: "CN=Bind,DC=example,DC=com",
  bindPassword: "secret",
  baseDn: "DC=example,DC=com",
  targetOuDn: "OU=Users,DC=example,DC=com",
  groupWriteBaseDn: "OU=Groups,DC=example,DC=com",
  upnSuffix: "example.com",
};

function guidBuffer() {
  return Buffer.from([
    0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66,
    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  ]);
}

function userEntry(overrides = {}) {
  return {
    dn: USER_DN,
    distinguishedName: USER_DN,
    sAMAccountName: "alice",
    userPrincipalName: "alice@example.com",
    employeeID: "E100",
    userAccountControl: "514",
    objectGUID: guidBuffer(),
    ...overrides,
  };
}

function groupEntry(members = []) {
  return {
    dn: GROUP_DN,
    distinguishedName: GROUP_DN,
    objectClass: "group",
    member: members,
  };
}

beforeEach(() => {
  ldapClient = {
    bind: jest.fn().mockResolvedValue(undefined),
    unbind: jest.fn().mockResolvedValue(undefined),
    search: jest.fn(),
    add: jest.fn().mockResolvedValue(undefined),
    modify: jest.fn().mockResolvedValue(undefined),
    del: jest.fn(),
  };
});

describe("AD locator and scope safety", () => {
  test("builds AD binary objectGUID filter value", () => {
    expect(objectGuidToLdapFilterValue(GUID)).toBe(
      "\\33\\22\\11\\00\\55\\44\\77\\66\\88\\99\\AA\\BB\\CC\\DD\\EE\\FF",
    );
  });

  test("rejects a DN outside the approved OU", () => {
    expect(() =>
      assertDnWithinScope(OUTSIDE_DN, cfg.targetOuDn),
    ).toThrow(/outside/i);
  });

  test("uses DN first and validates it by base search", async () => {
    ldapClient.search.mockResolvedValueOnce({ searchEntries: [userEntry()] });
    const target = await resolveAdUserTarget(
      ldapClient,
      normalizeAdConfig(cfg),
      { dn: USER_DN, objectGUID: GUID, sAMAccountName: "alice" },
    );
    expect(target.locatorType).toBe("DN");
    expect(ldapClient.search).toHaveBeenCalledTimes(1);
    expect(ldapClient.search.mock.calls[0][0]).toBe(USER_DN);
  });

  test("falls from missing DN to objectGUID before SAM", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [] })
      .mockResolvedValueOnce({ searchEntries: [userEntry()] });
    const target = await resolveAdUserTarget(
      ldapClient,
      normalizeAdConfig(cfg),
      { dn: USER_DN, objectGUID: GUID, sAMAccountName: "wrong" },
    );
    expect(target.locatorType).toBe("objectGUID");
    expect(ldapClient.search.mock.calls[1][1].filter).toContain("objectGUID=");
    expect(ldapClient.search).toHaveBeenCalledTimes(2);
  });

  test("uses SAM then UPN without combining locators", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [] })
      .mockResolvedValueOnce({ searchEntries: [userEntry()] });
    const target = await resolveAdUserTarget(
      ldapClient,
      normalizeAdConfig(cfg),
      { sAMAccountName: "missing", upn: "alice@example.com" },
    );
    expect(target.locatorType).toBe("UPN");
    expect(ldapClient.search.mock.calls[0][1].filter).toContain(
      "sAMAccountName=missing",
    );
    expect(ldapClient.search.mock.calls[1][1].filter).toContain(
      "userPrincipalName=alice@example.com",
    );
  });

  test("supports employeeId fallback", async () => {
    ldapClient.search.mockResolvedValueOnce({ searchEntries: [userEntry()] });
    const target = await resolveAdUserTarget(
      ldapClient,
      normalizeAdConfig(cfg),
      { employeeId: "E100" },
    );
    expect(target.locatorType).toBe("employeeId");
  });

  test("blocks an ambiguous locator without falling through", async () => {
    ldapClient.search.mockResolvedValueOnce({
      searchEntries: [userEntry(), userEntry({ dn: `${USER_DN}-2` })],
    });
    await expect(
      resolveAdUserTarget(ldapClient, normalizeAdConfig(cfg), {
        sAMAccountName: "alice",
        upn: "alice@example.com",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_AMBIGUOUS" });
    expect(ldapClient.search).toHaveBeenCalledTimes(1);
  });

  test("blocks an out-of-scope resolved account", async () => {
    ldapClient.search.mockResolvedValueOnce({
      searchEntries: [userEntry({ dn: OUTSIDE_DN, distinguishedName: OUTSIDE_DN })],
    });
    await expect(
      resolveAdUserTarget(ldapClient, normalizeAdConfig(cfg), {
        sAMAccountName: "alice",
      }),
    ).rejects.toMatchObject({ code: "AD_SCOPE_VIOLATION" });
  });
});

describe("AD account writes with mocked LDAP", () => {
  test("CREATE retains authoritative objectGUID after read-back", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [{ dn: cfg.targetOuDn }] })
      .mockResolvedValueOnce({ searchEntries: [] })
      .mockResolvedValueOnce({ searchEntries: [userEntry()] });
    const result = await createAdUser(cfg, {
      sAMAccountName: "alice",
      userPrincipalName: "alice@example.com",
      sn: "Example",
      displayName: "Alice",
    });
    expect(result.objectGUID).toBe(GUID);
    expect(result.verified.objectGUID).toBe(GUID);
    expect(ldapClient.add).toHaveBeenCalledTimes(1);
  });

  test("UPDATE writes only allowlisted attributes", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [userEntry()] })
      .mockResolvedValueOnce({ searchEntries: [userEntry({ department: "IT" })] });
    await updateAdUser(cfg, {
      dn: USER_DN,
      attributes: {
        department: "IT",
        unicodePwd: "never",
        userAccountControl: "0",
      },
    });
    const changes = ldapClient.modify.mock.calls[0][1];
    expect(changes.map((change) => change.modification.type)).toEqual([
      "department",
    ]);
  });

  test("ENABLE clears only ACCOUNTDISABLE", async () => {
    ldapClient.search.mockResolvedValueOnce({
      searchEntries: [userEntry({ userAccountControl: "514" })],
    });
    const result = await enableAdUser(cfg, { objectGUID: GUID });
    expect(result.userAccountControl).toBe(512);
    expect(result.noop).toBe(false);
    expect(ldapClient.modify.mock.calls[0][1][0]).toMatchObject({
      operation: "replace",
      modification: { type: "userAccountControl", values: ["512"] },
    });
  });

  test("repeated ENABLE is an idempotent no-op", async () => {
    ldapClient.search.mockResolvedValueOnce({
      searchEntries: [userEntry({ userAccountControl: "512" })],
    });
    const result = await enableAdUser(cfg, { sAMAccountName: "alice" });
    expect(result.noop).toBe(true);
    expect(ldapClient.modify).not.toHaveBeenCalled();
  });

  test("DISABLE sets only ACCOUNTDISABLE", async () => {
    ldapClient.search
      .mockResolvedValueOnce({
        searchEntries: [userEntry({ userAccountControl: "512" })],
      })
      .mockResolvedValueOnce({
        searchEntries: [userEntry({ userAccountControl: "512" })],
      });
    const result = await disableAdUser(cfg, { upn: "alice@example.com" });
    expect(result.userAccountControl).toBe(514);
    expect(ldapClient.modify.mock.calls[0][1][0].modification.values).toEqual([
      "514",
    ]);
  });

  test("repeated DISABLE is an idempotent no-op", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [userEntry()] })
      .mockResolvedValueOnce({ searchEntries: [userEntry()] });
    const result = await disableAdUser(cfg, { employeeId: "E100" });
    expect(result.noop).toBe(true);
    expect(ldapClient.modify).not.toHaveBeenCalled();
  });

  test("maps and redacts LDAP errors", () => {
    expect(
      wrapLdapError(
        new Error("vendor password=hunter2 bindPassword=bind-secret"),
        "LDAP update",
      ).message,
    ).toBe(
      "LDAP update: vendor password=[redacted] bindPassword=[redacted]",
    );
  });
});

describe("AD group membership writes", () => {
  test("ADD_ENTITLEMENT adds group member", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [userEntry()] })
      .mockResolvedValueOnce({ searchEntries: [groupEntry([])] });
    const result = await addAdGroupMember(cfg, {
      groupDn: GROUP_DN,
      userLocator: { objectGUID: GUID },
    });
    expect(result.changed).toBe(true);
    expect(ldapClient.modify.mock.calls[0][0]).toBe(GROUP_DN);
    expect(ldapClient.modify.mock.calls[0][1][0]).toMatchObject({
      operation: "add",
      modification: { type: "member", values: [USER_DN] },
    });
    expect(ldapClient.del).not.toHaveBeenCalled();
  });

  test("repeated ADD_ENTITLEMENT is a no-op", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [userEntry()] })
      .mockResolvedValueOnce({ searchEntries: [groupEntry([USER_DN])] });
    const result = await addAdGroupMember(cfg, {
      groupDn: GROUP_DN,
      userLocator: { sAMAccountName: "alice" },
    });
    expect(result.noop).toBe(true);
    expect(ldapClient.modify).not.toHaveBeenCalled();
  });

  test("REMOVE_ENTITLEMENT removes group member", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [userEntry()] })
      .mockResolvedValueOnce({ searchEntries: [groupEntry([USER_DN])] });
    const result = await removeAdGroupMember(cfg, {
      groupDn: GROUP_DN,
      userLocator: { sAMAccountName: "alice" },
    });
    expect(result.changed).toBe(true);
    expect(ldapClient.modify.mock.calls[0][1][0].operation).toBe("delete");
  });

  test("repeated REMOVE_ENTITLEMENT is a no-op", async () => {
    ldapClient.search
      .mockResolvedValueOnce({ searchEntries: [userEntry()] })
      .mockResolvedValueOnce({ searchEntries: [groupEntry([])] });
    const result = await removeAdGroupMember(cfg, {
      groupDn: GROUP_DN,
      userLocator: { sAMAccountName: "alice" },
    });
    expect(result.noop).toBe(true);
    expect(ldapClient.modify).not.toHaveBeenCalled();
  });

  test("rejects malformed or out-of-scope group targets", async () => {
    ldapClient.search.mockResolvedValueOnce({ searchEntries: [userEntry()] });
    await expect(
      addAdGroupMember(cfg, {
        groupDn: "VPN",
        userLocator: { sAMAccountName: "alice" },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_TARGET" });
    expect(ldapClient.modify).not.toHaveBeenCalled();
  });
});
