import {
  mergeQueryOverrides,
  normalizeBodyQueryOverrides,
} from "./applicationSecurityQueryService.js";

describe("normalizeBodyQueryOverrides", () => {
  test("normalizes object overrides", () => {
    const out = normalizeBodyQueryOverrides({
      empty_groups: {
        ldapFilter: "(&(objectClass=group))",
        searchBase: "OU=Security,DC=corp,DC=local",
        searchScope: "OneLevel",
      },
    });
    expect(out.empty_groups.ldapFilter).toBe("(&(objectClass=group))");
    expect(out.empty_groups.searchBase).toBe("OU=Security,DC=corp,DC=local");
    expect(out.empty_groups.searchScope).toBe("OneLevel");
  });

  test("supports legacy string filter overrides", () => {
    const out = normalizeBodyQueryOverrides({
      disabled_users: "(&(objectClass=user))",
    });
    expect(out.disabled_users.ldapFilter).toBe("(&(objectClass=user))");
  });
});

describe("mergeQueryOverrides", () => {
  test("body searchBase overrides db default", () => {
    const merged = mergeQueryOverrides(
      {
        empty_groups: {
          ldapFilter: "(&(objectClass=group))",
        },
      },
      {
        empty_groups: {
          searchBase: "OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl",
          searchScope: "Base",
        },
      },
    );
    expect(merged.empty_groups.searchBase).toBe(
      "OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl",
    );
    expect(merged.empty_groups.ldapFilter).toBe("(&(objectClass=group))");
    expect(merged.empty_groups.searchScope).toBe("Base");
  });
});
