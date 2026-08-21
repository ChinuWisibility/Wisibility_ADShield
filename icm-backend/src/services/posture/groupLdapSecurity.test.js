import {
  analyzeCircularMembershipsLdap,
  analyzeDuplicateGroupsLdap,
  analyzeNestedGroupsLdap,
  analyzeNestedPrivilegedAccessLdap,
  analyzeOrphanGroupsLdap,
  analyzeUnusedGroupsLdap,
  analyzeGraphFeatureForTests,
} from "./groupLdapSecurity.js";

const scanId = "test-scan";
const searchBase = "OU=Security,DC=corp,DC=local";

function group(name, dn, members = [], extra = {}) {
  return {
    groupName: name,
    displayName: name,
    distinguishedName: dn,
    dn,
    description: extra.description ?? "",
    members,
    memberAttributePresent: extra.memberAttributePresent ?? true,
    managedBy: extra.managedBy ?? "",
    memberOf: extra.memberOf ?? [],
  };
}

describe("group LDAP analyzers (PowerShell parity)", () => {
  test("analyzeUnusedGroupsLdap flags empty groups without incoming parents", () => {
    const { findings } = analyzeGraphFeatureForTests(
      analyzeUnusedGroupsLdap,
      [
        group("Unused", "CN=Unused,OU=Security,DC=corp,DC=local"),
        group("Used", "CN=Used,OU=Security,DC=corp,DC=local", [
          "CN=User1,DC=corp,DC=local",
        ]),
        group("Parent", "CN=Parent,OU=Security,DC=corp,DC=local", [
          "CN=Child,OU=Security,DC=corp,DC=local",
        ]),
        group("Child", "CN=Child,OU=Security,DC=corp,DC=local"),
      ],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].feature).toBe("unused_groups");
    expect(findings[0].objectName).toBe("Unused");
  });

  test("analyzeUnusedGroupsLdap ignores parent groups outside the search base", () => {
    const { findings } = analyzeGraphFeatureForTests(
      analyzeUnusedGroupsLdap,
      [
        group("Child", "CN=Child,OU=Security,DC=corp,DC=local"),
        group("Parent", "CN=Parent,OU=Distribution,DC=corp,DC=local", [
          "CN=Child,OU=Security,DC=corp,DC=local",
        ]),
      ],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].objectName).toBe("Child");
  });

  test("analyzeOrphanGroupsLdap requires empty, ownerless, unreferenced group", () => {
    const { findings } = analyzeGraphFeatureForTests(
      analyzeOrphanGroupsLdap,
      [
        group("Orphan", "CN=Orphan,OU=Security,DC=corp,DC=local"),
        group("HasOwner", "CN=HasOwner,OU=Security,DC=corp,DC=local", [], {
          managedBy: "CN=Admin,DC=corp,DC=local",
        }),
        group("HasMemberOf", "CN=HasMemberOf,OU=Security,DC=corp,DC=local", [], {
          memberOf: ["CN=Other,DC=corp,DC=local"],
        }),
        group("Referenced", "CN=Referenced,OU=Security,DC=corp,DC=local"),
        group("Parent", "CN=Parent,OU=Security,DC=corp,DC=local", [
          "CN=Referenced,OU=Security,DC=corp,DC=local",
        ]),
      ],
      searchBase,
      scanId,
    );
    expect(findings.map((f) => f.objectName).sort()).toEqual([
      "HasMemberOf",
      "Orphan",
    ]);
  });

  test("analyzeDuplicateGroupsLdap finds groups with identical description", () => {
    const { findings } = analyzeGraphFeatureForTests(
      analyzeDuplicateGroupsLdap,
      [
        group("A", "CN=A,OU=Security,DC=corp,DC=local", [], {
          description: "Shared desc",
        }),
        group("B", "CN=B,OU=Security,DC=corp,DC=local", [], {
          description: "Shared desc",
        }),
        group("C", "CN=C,OU=Security,DC=corp,DC=local", [], {
          description: "Unique",
        }),
      ],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.feature === "duplicate_groups")).toBe(true);
  });

  test("analyzeNestedGroupsLdap enumerates every parent-child edge recursively", () => {
    const g1 = "CN=G1,OU=Security,DC=corp,DC=local";
    const g2 = "CN=G2,OU=Security,DC=corp,DC=local";
    const g3 = "CN=G3,OU=Security,DC=corp,DC=local";
    const { findings } = analyzeGraphFeatureForTests(
      analyzeNestedGroupsLdap,
      [group("G1", g1, [g2]), group("G2", g2, [g3]), group("G3", g3)],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.objectName).sort()).toEqual(["G2", "G3", "G3"]);
  });

  test("analyzeCircularMembershipsLdap reports each unique cycle once", () => {
    const g1 = "CN=G1,OU=Security,DC=corp,DC=local";
    const g2 = "CN=G2,OU=Security,DC=corp,DC=local";
    const { findings } = analyzeGraphFeatureForTests(
      analyzeCircularMembershipsLdap,
      [group("G1", g1, [g2]), group("G2", g2, [g1])],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].feature).toBe("circular_memberships");
  });

  test("analyzeNestedPrivilegedAccessLdap matches test.ps1 seed topology", () => {
    const target = "CN=WIS-Seed-Priv-Nested-Target-Admin,OU=Security,DC=corp,DC=local";
    const wrapper = "CN=WIS-Seed-Priv-Nested-Wrapper,OU=Security,DC=corp,DC=local";
    const { findings } = analyzeGraphFeatureForTests(
      analyzeNestedPrivilegedAccessLdap,
      [
        group("WIS-Seed-Priv-Nested-Target-Admin", target, [
          "CN=WIS-Sd-PrivDir,DC=corp,DC=local",
        ], {
          memberOf: [wrapper],
        }),
        group("WIS-Seed-Priv-Nested-Wrapper", wrapper, [
          "CN=WIS-Sd-PrivNest,DC=corp,DC=local",
        ]),
      ],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].feature).toBe("nested_privileged_access");
    expect(findings[0].objectName).toBe("WIS-Seed-Priv-Nested-Target-Admin");
  });

  test("analyzeNestedPrivilegedAccessLdap respects search base", () => {
    const target = "CN=WIS-Seed-Priv-Nested-Target-Admin,OU=Other,DC=corp,DC=local";
    const wrapper = "CN=WIS-Seed-Priv-Nested-Wrapper,OU=Other,DC=corp,DC=local";
    const { findings } = analyzeGraphFeatureForTests(
      analyzeNestedPrivilegedAccessLdap,
      [
        group("WIS-Seed-Priv-Nested-Target-Admin", target, [
          "CN=WIS-Sd-PrivDir,DC=corp,DC=local",
        ], {
          memberOf: [wrapper],
        }),
        group("WIS-Seed-Priv-Nested-Wrapper", wrapper),
      ],
      searchBase,
      scanId,
    );
    expect(findings).toHaveLength(0);
  });
});
