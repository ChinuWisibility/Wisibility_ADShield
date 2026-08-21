import {
  buildGroupAnalysisCatalog,
  buildScopedGroupCatalog,
  getDirectMemberCount,
  getIncomingParentCountInScope,
  isDnUnderSearchBase,
  resolveGraphGroupSearchBase,
} from "./groupAnalysisCatalog.js";

describe("groupAnalysisCatalog", () => {
  test("isDnUnderSearchBase matches PowerShell suffix rule", () => {
    const base = "OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl";
    const dn = "CN=Test,OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl";
    expect(isDnUnderSearchBase(dn, base)).toBe(true);
    expect(isDnUnderSearchBase("CN=Other,OU=Distribution,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl", base)).toBe(false);
  });

  test("resolveGraphGroupSearchBase uses feature search base by default", () => {
    const featureBase =
      "OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl";
    expect(resolveGraphGroupSearchBase(featureBase, {})).toBe(featureBase);
  });

  test("getDirectMemberCount uses member array length", () => {
    expect(getDirectMemberCount({ members: [] })).toBe(0);
    expect(getDirectMemberCount({ members: ["CN=U,DC=corp,DC=local"] })).toBe(1);
    expect(getDirectMemberCount({ members: null })).toBe(0);
  });

  test("buildGroupAnalysisCatalog supplements childToParent from memberOf", () => {
    const groups = [
      {
        groupName: "Child",
        distinguishedName: "CN=Child,OU=Security,DC=corp,DC=local",
        members: [],
        memberOf: ["CN=Parent,OU=Security,DC=corp,DC=local"],
      },
      {
        groupName: "Parent",
        distinguishedName: "CN=Parent,OU=Security,DC=corp,DC=local",
        members: [],
      },
    ];
    const catalog = buildGroupAnalysisCatalog(groups);
    const scoped = buildScopedGroupCatalog(catalog, "OU=Security,DC=corp,DC=local");
    expect(
      getIncomingParentCountInScope(
        catalog,
        scoped,
        "CN=Child,OU=Security,DC=corp,DC=local",
      ),
    ).toBe(1);
  });

  test("buildGroupAnalysisCatalog indexes childToParent by canonical child DN", () => {
    const groups = [
      {
        groupName: "Child",
        distinguishedName: "CN=Child,OU=Security,DC=corp,DC=local",
        members: [],
      },
      {
        groupName: "Parent",
        distinguishedName: "CN=Parent,OU=Security,DC=corp,DC=local",
        members: ["cn=child,ou=security,dc=corp,dc=local"],
      },
    ];
    const catalog = buildGroupAnalysisCatalog(groups);
    expect(
      getIncomingParentCountInScope(
        catalog,
        buildScopedGroupCatalog(catalog, "OU=Security,DC=corp,DC=local"),
        "CN=Child,OU=Security,DC=corp,DC=local",
      ),
    ).toBe(1);
  });

  test("buildGroupAnalysisCatalog parent outside scoped search base does not count for in-scope child", () => {
    const groups = [
      {
        groupName: "Child",
        distinguishedName: "CN=Child,OU=Security,DC=corp,DC=local",
        members: [],
        memberAttributePresent: true,
      },
      {
        groupName: "Parent",
        distinguishedName: "CN=Parent,OU=Distribution,DC=corp,DC=local",
        members: ["CN=Child,OU=Security,DC=corp,DC=local"],
        memberAttributePresent: true,
      },
    ];
    const catalog = buildGroupAnalysisCatalog(groups);
    expect(
      catalog.parentGroupMap.get("cn=child,ou=security,dc=corp,dc=local"),
    ).toEqual(["CN=Parent,OU=Distribution,DC=corp,DC=local"]);

    const scoped = buildScopedGroupCatalog(
      catalog,
      "OU=Security,DC=corp,DC=local",
    );
    expect(scoped.groupCount).toBe(1);
    expect(getIncomingParentCountInScope(catalog, scoped, "CN=Child,OU=Security,DC=corp,DC=local")).toBe(0);
  });
});
