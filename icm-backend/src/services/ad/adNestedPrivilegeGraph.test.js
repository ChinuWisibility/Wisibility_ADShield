import { describe, expect, test } from "@jest/globals";
import { buildAdEntitlementRows } from "../application/applicationEntitlementIngestService.js";
import { buildEdgesFromDirectoryPayload } from "../graph/graphIncrementalUpdateService.js";
import { supplementScanGraphNestingFromEntitlements } from "../graph/graphEdgeBuilder.js";
import { extractGroupMemberOfDns } from "../graph/graphNodeResolver.js";
import { GRAPH_EDGE_TYPES } from "../graph/graphConstants.js";
import {
  discoverNestedPrivilegedAccess,
  findPrivilegeEscalationPaths,
} from "../security/privilegedAccess/privilegedAccessService.js";
import { bfsTraversal, shortestPath } from "../graph/graphTraversalEngine.js";
import { buildReverseAdjacency } from "../graph/graphAdjacencyCacheService.js";

describe("AD entitlement rows preserve group nesting attrs", () => {
  test("buildAdEntitlementRows includes memberOf for graph/nest detectors", () => {
    const rows = buildAdEntitlementRows([
      {
        groupName: "WIS-Seed-Priv-Nested-Target-Admin",
        groupDN: "CN=WIS-Seed-Priv-Nested-Target-Admin,DC=ex,DC=com",
        objectSid: "S-1-5-21-1",
        members: [],
        memberOf: ["CN=WIS-Seed-Priv-Nested-Wrapper,DC=ex,DC=com"],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberOf).toEqual([
      "CN=WIS-Seed-Priv-Nested-Wrapper,DC=ex,DC=com",
    ]);
    expect(rows[0].members).toEqual([]);
  });

  test("buildAdEntitlementRows coerces string memberOf", () => {
    const rows = buildAdEntitlementRows([
      {
        groupName: "Target-Admin",
        groupDN: "CN=Target-Admin,DC=ex,DC=com",
        objectSid: "S-1-5-21-1",
        members: [],
        memberOf: "CN=Wrapper,DC=ex,DC=com",
      },
    ]);
    expect(rows[0].memberOf).toEqual(["CN=Wrapper,DC=ex,DC=com"]);
  });
});

describe("extractGroupMemberOfDns coerces LDAP single-value strings", () => {
  test("string memberOf yields one DN", () => {
    expect(
      extractGroupMemberOfDns({
        rawData: { memberOf: "CN=Wrapper,DC=ex,DC=com" },
      }),
    ).toEqual(["CN=Wrapper,DC=ex,DC=com"]);
  });
});

describe("directory graph payload builds nested edges from memberOf", () => {
  test("Wrapper→Target nested edge exists when members are empty (fast sync)", () => {
    const tenantId = "tenant1";
    const applicationId = "app1";
    const wrapperDn = "CN=WIS-Seed-Priv-Nested-Wrapper,DC=ex,DC=com";
    const targetDn = "CN=WIS-Seed-Priv-Nested-Target-Admin,DC=ex,DC=com";
    const wrapperNode = `${tenantId}:${applicationId}:GROUP:wrapper`;
    const targetNode = `${tenantId}:${applicationId}:GROUP:target-admin`;

    const { edges } = buildEdgesFromDirectoryPayload({
      tenantId,
      applicationId,
      userDocs: [],
      groups: [
        {
          groupName: "WIS-Seed-Priv-Nested-Wrapper",
          groupDN: wrapperDn,
          objectSid: "S-1-5-21-w",
          members: [],
          memberOf: [],
        },
        {
          groupName: "WIS-Seed-Priv-Nested-Target-Admin",
          groupDN: targetDn,
          objectSid: "S-1-5-21-t",
          members: [],
          memberOf: [wrapperDn],
        },
      ],
      privilegedGroupNodeIds: new Set([targetNode]),
      dnToGroupNodeId: new Map([
        [wrapperDn.toLowerCase(), wrapperNode],
        [targetDn.toLowerCase(), targetNode],
      ]),
    });

    const nested = edges.filter(
      (e) => e.relationshipType === GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
    );
    expect(nested).toHaveLength(1);
    expect(nested[0].sourceNodeId).toBe(wrapperNode);
    expect(nested[0].targetNodeId).toContain(":GROUP:");
    expect(nested[0].targetNodeId).not.toBe(wrapperNode);
    expect(nested[0].metadata?.derivedFrom).toBe("memberOf");
  });
});

describe("supplementScanGraphNestingFromEntitlements heals seed topology", () => {
  test("detects nested privileged + escalation after supplementing stale graph", async () => {
    const tenantId = "tenant1";
    const applicationId = "app1";
    const wrapperDn = "CN=WIS-Seed-Priv-Nested-Wrapper,DC=ex,DC=com";
    const targetDn = "CN=WIS-Seed-Priv-Nested-Target-Admin,DC=ex,DC=com";
    const wrapperNode = `${tenantId}:${applicationId}:GROUP:sid:s-1-5-21-w`;
    const targetNode = `${tenantId}:${applicationId}:GROUP:sid:s-1-5-21-t`;
    const privDir = `${tenantId}:${applicationId}:USER:wis-sd-privdir`;
    const privNest = `${tenantId}:${applicationId}:USER:wis-sd-privnest`;

    // Stale graph: user memberships only — no NESTED_MEMBER_OF, no PRIVILEGED_ACCESS.
    const membershipAdj = new Map([
      [privDir, [targetNode]],
      [privNest, [wrapperNode]],
    ]);
    const scanGraph = {
      membershipAdj,
      nestedGroupAdj: new Map(),
      incomingByTarget: buildReverseAdjacency(membershipAdj),
      privilegeGroupIds: new Set(),
      privilegedGroupsReachable(userNodeId, maxDepth = 16) {
        if (!this.privilegeGroupIds.size) return [];
        const { visited } = bfsTraversal(
          userNodeId,
          (id) => this.membershipAdj.get(id) || [],
          { maxDepth },
        );
        return [...visited].filter((n) => this.privilegeGroupIds.has(n));
      },
      shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth = 12) {
        return shortestPath(
          userNodeId,
          targetGroupId,
          (id) => this.membershipAdj.get(id) || [],
          { maxDepth },
        );
      },
    };

    const entitlements = [
      {
        entitlement_id: "S-1-5-21-w",
        entitlement_name: "WIS-Seed-Priv-Nested-Wrapper",
        rawData: {
          groupDN: wrapperDn,
          objectSid: "S-1-5-21-w",
          members: [],
          memberOf: [],
        },
      },
      {
        entitlement_id: "S-1-5-21-t",
        entitlement_name: "WIS-Seed-Priv-Nested-Target-Admin",
        rawData: {
          groupDN: targetDn,
          objectSid: "S-1-5-21-t",
          members: [],
          // Single-value string as stored by buildRawDataFromEntry
          memberOf: wrapperDn,
        },
      },
    ];

    const heal = supplementScanGraphNestingFromEntitlements({
      tenantId,
      applicationId,
      scanGraph,
      entitlements,
    });
    expect(heal.nestedEdgesAdded).toBeGreaterThanOrEqual(1);
    expect(heal.privilegeGroupsAdded).toBeGreaterThanOrEqual(1);
    expect(scanGraph.privilegeGroupIds.has(targetNode)).toBe(true);

    const nested = await discoverNestedPrivilegedAccess({
      scanId: "scan-heal",
      scanGraph,
    });
    expect(nested.count).toBeGreaterThanOrEqual(1);

    const escalation = await findPrivilegeEscalationPaths({
      tenantId,
      applicationId,
      scanId: "scan-heal",
      scanGraph,
      analysisCtx: {
        users: [
          {
            user_id: "WIS-Sd-PrivNest",
            display_name: "WIS-Seed-Nested-Priv-User",
            rawData: { sAMAccountName: "WIS-Sd-PrivNest" },
          },
        ],
        privilegedGroupsReachable: scanGraph.privilegedGroupsReachable.bind(scanGraph),
        shortestPathToPrivileged: scanGraph.shortestPathToPrivileged.bind(scanGraph),
      },
    });
    expect(escalation.count).toBeGreaterThanOrEqual(1);
  });
});
