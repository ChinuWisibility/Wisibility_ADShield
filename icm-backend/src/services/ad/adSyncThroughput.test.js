import { describe, expect, test } from "@jest/globals";
import {
  buildMembershipIndex,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./ldapNormalizer.js";
import { buildNestedMemberEdgesForGroup } from "./graph/graphEdgeBuilder.js";

describe("AD sync LDAP throughput helpers", () => {
  test("default page size is LDAP-browser scale", () => {
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThanOrEqual(1000);
    expect(MAX_PAGE_SIZE).toBeGreaterThanOrEqual(DEFAULT_PAGE_SIZE);
  });

  test("buildMembershipIndex inverts memberOf when group.members are empty", () => {
    const users = [
      {
        userId: "alice",
        distinguishedName: "CN=alice,DC=ex,DC=com",
        memberOf: ["CN=Admins,DC=ex,DC=com", "CN=Users,DC=ex,DC=com"],
      },
    ];
    const groups = [
      {
        groupName: "Admins",
        groupDN: "CN=Admins,DC=ex,DC=com",
        members: [],
        memberOf: [],
      },
      {
        groupName: "Users",
        groupDN: "CN=Users,DC=ex,DC=com",
        members: [],
        memberOf: [],
      },
    ];
    const { userToGroups, groupToUsers } = buildMembershipIndex(users, groups);
    expect(userToGroups.get("alice")).toHaveLength(2);
    expect(groupToUsers.get("cn=admins,dc=ex,dc=com")).toContain("alice");
    expect(groupToUsers.get("cn=users,dc=ex,dc=com")).toContain("alice");
  });

  test("nested edges derive from group memberOf when members are absent", () => {
    const tenantId = "t1";
    const applicationId = "a1";
    const parentDn = "CN=Wrapper,DC=ex,DC=com";
    const childDn = "CN=Target,DC=ex,DC=com";
    const parentNode = `${tenantId}:${applicationId}:GROUP:wrapper`;
    const childNode = `${tenantId}:${applicationId}:GROUP:target`;
    const dnToGroupNodeId = new Map([
      [parentDn.toLowerCase(), parentNode],
      [childDn.toLowerCase(), childNode],
    ]);
    const edges = buildNestedMemberEdgesForGroup(
      tenantId,
      applicationId,
      {
        entitlement_id: "target",
        entitlement_name: "Target",
        rawData: {
          groupDN: childDn,
          members: [],
          memberOf: [parentDn],
        },
      },
      dnToGroupNodeId,
    );
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0].sourceNodeId).toBe(parentNode);
    expect(edges[0].relationshipType).toBe("NESTED_MEMBER_OF");
    expect(edges[0].metadata?.derivedFrom).toBe("memberOf");
  });

  test("nested edges still derive from memberOf when members lists only users", () => {
    const tenantId = "t1";
    const applicationId = "a1";
    const parentDn = "CN=Wrapper,DC=ex,DC=com";
    const childDn = "CN=Target-Admin,DC=ex,DC=com";
    const parentNode = `${tenantId}:${applicationId}:GROUP:wrapper`;
    const childNode = `${tenantId}:${applicationId}:GROUP:target`;
    const dnToGroupNodeId = new Map([
      [parentDn.toLowerCase(), parentNode],
      [childDn.toLowerCase(), childNode],
    ]);
    const edges = buildNestedMemberEdgesForGroup(
      tenantId,
      applicationId,
      {
        entitlement_id: "target",
        entitlement_name: "Target-Admin",
        rawData: {
          groupDN: childDn,
          objectSid: "S-1-5-21-target",
          // User DN is not in the group catalog — previously this early-returned
          // and dropped the Wrapper→Target nesting link from memberOf.
          members: ["CN=PrivDir,DC=ex,DC=com"],
          memberOf: [parentDn],
        },
      },
      dnToGroupNodeId,
    );
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const fromMemberOf = edges.find((e) => e.metadata?.derivedFrom === "memberOf");
    expect(fromMemberOf).toBeTruthy();
    expect(fromMemberOf.sourceNodeId).toBe(parentNode);
    // Child node id is resolved from entitlement (sid/dn), not the map key alone.
    expect(fromMemberOf.targetNodeId).toContain(":GROUP:");
    expect(fromMemberOf.targetNodeId).not.toBe(parentNode);
  });
});
