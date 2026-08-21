import { describe, expect, test } from "@jest/globals";
import {
  AD_UAC_DISABLED_NORMAL,
  buildAdUserCreatePayload,
  resolveSamAccountName,
  validateSamAccountName,
} from "./adUserCreatePayload.js";
import { wrapLdapError } from "./adLdapService.js";

const baseCfg = {
  targetOuDn: "OU=Provisioning,DC=wisibility,DC=lcl",
  upnSuffix: "wisibility.lcl",
  samAccountNameSource: "explicit",
};

describe("adUserCreatePayload", () => {
  test("normal identity", () => {
    const payload = buildAdUserCreatePayload(
      {
        sAMAccountName: "jdoe",
        givenName: "Jane",
        sn: "Doe",
        displayName: "Jane Doe",
        mail: "jane.doe@example.com",
        department: "IT",
        title: "Engineer",
        employeeId: "E100",
      },
      baseCfg,
    );
    expect(payload.dn).toBe("CN=Jane Doe,OU=Provisioning,DC=wisibility,DC=lcl");
    expect(payload.attributes.sAMAccountName).toBe("jdoe");
    expect(payload.attributes.userPrincipalName).toBe("jdoe@wisibility.lcl");
    expect(payload.attributes.givenName).toBe("Jane");
    expect(payload.attributes.sn).toBe("Doe");
    expect(payload.attributes.employeeID).toBe("E100");
    expect(payload.attributes.mail).toBe("jane.doe@example.com");
    expect(payload.attributes.department).toBe("IT");
    expect(payload.attributes.userAccountControl).toBe(String(AD_UAC_DISABLED_NORMAL));
    expect(payload.meta.accountEnabled).toBe(false);
    expect(payload.meta.passwordSet).toBe(false);
  });

  test("missing first name is allowed (optional givenName)", () => {
    const payload = buildAdUserCreatePayload(
      { sAMAccountName: "alone", sn: "Only" },
      baseCfg,
    );
    expect(payload.attributes.givenName).toBeUndefined();
    expect(payload.attributes.sn).toBe("Only");
    expect(payload.dn.startsWith("CN=alone,") || payload.dn.startsWith("CN=Only,")).toBe(true);
  });

  test("missing last name fails", () => {
    expect(() =>
      buildAdUserCreatePayload({ sAMAccountName: "x", givenName: "X" }, baseCfg),
    ).toThrow(/sn/);
  });

  test("missing employee ID is allowed (optional)", () => {
    const payload = buildAdUserCreatePayload(
      { sAMAccountName: "noemp", sn: "User" },
      baseCfg,
    );
    expect(payload.attributes.employeeID).toBeUndefined();
  });

  test("missing username source fails for explicit", () => {
    expect(() =>
      buildAdUserCreatePayload({ sn: "User" }, baseCfg),
    ).toThrow(/sAMAccountName is required/);
  });

  test("employeeId source uses employeeId", () => {
    const r = resolveSamAccountName(
      { employeeId: "EMP42" },
      { samAccountNameSource: "employeeId" },
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe("EMP42");
  });

  test("optional attributes omitted when empty", () => {
    const payload = buildAdUserCreatePayload(
      { sAMAccountName: "minuser", sn: "Min" },
      baseCfg,
    );
    expect(payload.attributes.mail).toBeUndefined();
    expect(payload.attributes.department).toBeUndefined();
    expect(payload.attributes.title).toBeUndefined();
  });

  test("comma in displayName is escaped in DN", () => {
    const payload = buildAdUserCreatePayload(
      { sAMAccountName: "cuser", sn: "User", displayName: "User, Test" },
      baseCfg,
    );
    expect(payload.dn).toBe("CN=User\\, Test,OU=Provisioning,DC=wisibility,DC=lcl");
  });

  test("invalid sam rejected", () => {
    expect(validateSamAccountName("bad name").ok).toBe(false);
    expect(validateSamAccountName("").ok).toBe(false);
    expect(validateSamAccountName("a".repeat(21)).ok).toBe(false);
  });

  test("requires targetOuDn", () => {
    expect(() =>
      buildAdUserCreatePayload(
        { sAMAccountName: "x", sn: "Y" },
        { upnSuffix: "wisibility.lcl" },
      ),
    ).toThrow(/targetOuDn/);
  });

  test("requires upnSuffix when UPN not explicit", () => {
    expect(() =>
      buildAdUserCreatePayload(
        { sAMAccountName: "x", sn: "Y" },
        { targetOuDn: "OU=U,DC=x,DC=y" },
      ),
    ).toThrow(/upnSuffix/);
  });
});

describe("wrapLdapError classification", () => {
  test("LDAP 68 already exists", () => {
    const e = wrapLdapError({ code: 68, message: "Entry Already Exists" });
    expect(e.code).toBe("LDAP_ALREADY_EXISTS");
  });

  test("LDAP 50 insufficient access", () => {
    const e = wrapLdapError({ code: 50, name: "InsufficientAccessError", message: "x" });
    expect(e.code).toBe("LDAP_INSUFFICIENT_ACCESS");
  });

  test("LDAP 19 constraint", () => {
    const e = wrapLdapError({ code: 19, message: "Constraint Violation" });
    expect(e.code).toBe("LDAP_CONSTRAINT_VIOLATION");
  });

  test("LDAP 49 invalid credentials", () => {
    const e = wrapLdapError({ code: 49, message: "Invalid Credentials" });
    expect(e.code).toBe("LDAP_INVALID_CREDENTIALS");
  });

  test("does not leak password-like substrings", () => {
    const e = wrapLdapError({ message: "fail password=SuperSecret123" });
    expect(e.message).not.toMatch(/SuperSecret123/);
    expect(e.message).toMatch(/\[redacted\]/);
  });
});

describe("duplicate filter", () => {
  test("escapes special chars in sAMAccountName and UPN", async () => {
    const { buildDuplicateAdUserFilter } = await import("./adLdapService.js");
    const f = buildDuplicateAdUserFilter({
      sAMAccountName: "a(b)",
      userPrincipalName: "x*y@ex.com",
    });
    expect(f).toContain("sAMAccountName=a\\28b\\29");
    expect(f).toContain("userPrincipalName=x\\2ay@ex.com");
    expect(f).toMatch(/^\(&\(objectClass=user\)\(\|\(sAMAccountName=.+\)\(userPrincipalName=.+\)\)\)$/);
  });
});
