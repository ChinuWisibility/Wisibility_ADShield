import {
  resolveFeatureLdapFilter,
  resolveFeatureSearchBase,
  resolveFeatureQuery,
  normalizeSearchScope,
} from "./postureFeatureLdap.js";
import { friendlyLdapErrorMessage } from "./postureLdapValidator.js";
import {
  validateSearchBaseDn,
  validateSearchScope,
  validateLdapQueryFields,
} from "./ldapFilterValidator.js";

describe("resolveFeatureLdapFilter", () => {
  test("uses registry filter for disabled_users when no override", () => {
    const filter = resolveFeatureLdapFilter("disabled_users", {});
    expect(filter).toContain("userAccountControl:1.2.840.113556.1.4.803:=2");
    expect(filter).toContain("objectClass=user");
  });

  test("prefers query override over registry filter", () => {
    const custom = "(&(objectClass=user)(cn=Guest))";
    const filter = resolveFeatureLdapFilter("disabled_users", {
      disabled_users: { ldapFilter: custom },
    });
    expect(filter).toBe(custom);
  });

  test("supports legacy string query override", () => {
    const custom = "(&(objectClass=user)(cn=Guest))";
    const filter = resolveFeatureLdapFilter("disabled_users", {
      disabled_users: custom,
    });
    expect(filter).toBe(custom);
  });

  test("each user feature resolves independently", () => {
    const disabled = resolveFeatureLdapFilter("disabled_users", {});
    const inactive = resolveFeatureLdapFilter("inactive_users", {});
    expect(disabled).not.toBe(inactive);
  });

  test("empty_groups uses AD member-absent filter", () => {
    const filter = resolveFeatureLdapFilter("empty_groups", {});
    expect(filter).toBe(
      "(&(objectCategory=group)(objectClass=group)(!(member=*)))",
    );
  });

  test("all group LDAP features resolve a group filter", () => {
    const groupFeatures = [
      "empty_groups",
      "groups_without_owners",
      "unused_groups",
      "orphan_groups",
      "duplicate_groups",
      "nested_groups",
      "circular_memberships",
    ];
    for (const featureId of groupFeatures) {
      const filter = resolveFeatureLdapFilter(featureId, {});
      expect(filter).toContain("objectClass=group");
    }
  });

  test("disabled_computers uses broad computer filter (test.ps1 in-memory UAC parity)", () => {
    const filter = resolveFeatureLdapFilter("disabled_computers", {});
    expect(filter).toContain("objectCategory=computer");
    expect(filter).not.toContain("userAccountControl:1.2.840.113556.1.4.803:=2");
  });

  test("all computer LDAP features resolve a computer filter", () => {
    for (const featureId of [
      "disabled_computers",
      "inactive_computers",
      "missing_os_information",
    ]) {
      const filter = resolveFeatureLdapFilter(featureId, {});
      expect(filter).toMatch(/objectClass=computer|objectCategory=computer/);
    }
  });

  test("kerberos features resolve registry filters", () => {
    expect(resolveFeatureLdapFilter("kerberoastable_accounts", {})).toContain(
      "servicePrincipalName=*",
    );
    expect(resolveFeatureLdapFilter("spn_misconfigurations", {})).toContain(
      "servicePrincipalName=*",
    );
    expect(resolveFeatureLdapFilter("rbcd", {})).toContain(
      "msDS-AllowedToActOnBehalfOfOtherIdentity=*",
    );
  });
});

describe("resolveFeatureSearchBase / resolveFeatureQuery", () => {
  const cfg = { baseDn: "DC=wisibility,DC=lcl" };

  test("uses application base DN when no override and no registry default", () => {
    expect(resolveFeatureSearchBase("empty_groups", {}, cfg)).toBe(
      "DC=wisibility,DC=lcl",
    );
  });

  test("prefers feature search base override", () => {
    const override = "OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl";
    expect(
      resolveFeatureSearchBase("empty_groups", {
        empty_groups: { searchBase: override },
      }, cfg),
    ).toBe(override);
  });

  test("falls back to application base DN when registry has no defaultSearchBaseDn", () => {
    const resolved = resolveFeatureQuery("rbcd", {}, cfg);
    expect(resolved.searchBaseDn).toBe("DC=wisibility,DC=lcl");
    expect(resolved.objectTypes).toEqual(["computer"]);
  });

  test("override beats application base DN", () => {
    const override = "OU=Computers,DC=example,DC=com";
    const resolved = resolveFeatureQuery(
      "rbcd",
      { rbcd: { searchBase: override } },
      cfg,
    );
    expect(resolved.searchBaseDn).toBe(override);
    expect(resolved.overrideUsed).toBe(true);
  });

  test("ignores empty search base override", () => {
    expect(
      resolveFeatureSearchBase("empty_groups", {
        empty_groups: { searchBase: "   " },
      }, cfg),
    ).toBe("DC=wisibility,DC=lcl");
  });

  test("defaults searchScope to Subtree", () => {
    expect(resolveFeatureQuery("disabled_users", {}, cfg).searchScope).toBe("Subtree");
  });

  test("honors searchScope override", () => {
    const resolved = resolveFeatureQuery(
      "disabled_users",
      { disabled_users: { searchScope: "OneLevel" } },
      cfg,
    );
    expect(resolved.searchScope).toBe("OneLevel");
    expect(resolved.overrideUsed).toBe(true);
  });

  test("kerberoastable is user-scoped", () => {
    expect(resolveFeatureQuery("kerberoastable_accounts", {}, cfg).objectTypes).toEqual([
      "user",
    ]);
  });

  test("unconstrained includes user and computer", () => {
    expect(resolveFeatureQuery("unconstrained_delegation", {}, cfg).objectTypes).toEqual([
      "user",
      "computer",
    ]);
  });

  test("normalizeSearchScope rejects unknown values", () => {
    expect(normalizeSearchScope("bogus")).toBe("Subtree");
    expect(normalizeSearchScope("Base")).toBe("Base");
  });
});

describe("LDAP query field validation", () => {
  test("validateSearchBaseDn accepts empty and DN-shaped values", () => {
    expect(validateSearchBaseDn("").valid).toBe(true);
    expect(validateSearchBaseDn("OU=Users,DC=wisibility,DC=lcl").valid).toBe(true);
    expect(validateSearchBaseDn("not-a-dn").valid).toBe(false);
  });

  test("validateSearchScope accepts known scopes", () => {
    expect(validateSearchScope("Subtree").valid).toBe(true);
    expect(validateSearchScope("Base").valid).toBe(true);
    expect(validateSearchScope("bogus").valid).toBe(false);
  });

  test("validateLdapQueryFields combines filter and DN checks", () => {
    const bad = validateLdapQueryFields({
      ldapFilter: "objectClass=user",
      searchBase: "bad",
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});

describe("friendlyLdapErrorMessage", () => {
  test("maps invalid credentials", () => {
    expect(friendlyLdapErrorMessage({ code: 49 })).toBe(
      "The LDAP credentials are invalid.",
    );
  });

  test("maps missing search base", () => {
    expect(
      friendlyLdapErrorMessage(new Error("No Such Object: dc=missing,dc=local")),
    ).toBe("The configured search base does not exist.");
  });

  test("maps connection failures", () => {
    expect(friendlyLdapErrorMessage(new Error("connect ECONNREFUSED"))).toBe(
      "Unable to bind to Active Directory.",
    );
  });
});
