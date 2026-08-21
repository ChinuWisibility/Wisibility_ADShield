import { describe, expect, test } from "@jest/globals";
import {
  discoverNestedPrivilegedAccess,
  findDormantPrivilegedUsers,
  detectExcessivePrivileges,
  findPrivilegeEscalationPaths,
} from "./privilegedAccessService.js";
import { isPrivilegedEntitlement } from "../../identity/posture/identityPostureDashboard.js";
import { TOXIC_PRIVILEGE_MIN_GROUPS } from "../../graph/graphConstants.js";
import { bfsTraversal, shortestPath } from "../../graph/graphTraversalEngine.js";
import { buildReverseAdjacency } from "../../graph/graphAdjacencyCacheService.js";

/**
 * Build an in-memory scan graph that mirrors lab seed topology:
 *   PrivDir --MEMBER_OF--> TargetAdmin (privileged)
 *   Wrapper --NESTED--> TargetAdmin
 *   PrivNest --MEMBER_OF--> Wrapper
 *   ToxicUser --MEMBER_OF--> Admin01, Admin02
 *   ExPriv --MEMBER_OF--> Admin01..Admin06
 *   DormPriv --MEMBER_OF--> Admin01 (never logged on)
 */
function buildSeedLikeContext() {
  const tenantId = "tenant1";
  const applicationId = "app1";
  const scanId = "scan-priv-seed";

  const nodes = {
    privDir: `${tenantId}:${applicationId}:USER:wis-sd-privdir`,
    privNest: `${tenantId}:${applicationId}:USER:wis-sd-privnest`,
    dormPriv: `${tenantId}:${applicationId}:USER:wis-sd-dormpriv`,
    toxic: `${tenantId}:${applicationId}:USER:wis-sd-toxic`,
    exPriv: `${tenantId}:${applicationId}:USER:wis-sd-expriv`,
    target: `${tenantId}:${applicationId}:GROUP:wis-seed-priv-nested-target-admin`,
    wrapper: `${tenantId}:${applicationId}:GROUP:wis-seed-priv-nested-wrapper`,
  };

  const adminGroups = [];
  for (let i = 1; i <= 6; i += 1) {
    adminGroups.push(
      `${tenantId}:${applicationId}:GROUP:wis-seed-privileged-admin-${String(i).padStart(2, "0")}`,
    );
  }

  const membershipAdj = new Map();
  const addEdge = (from, to) => {
    const list = membershipAdj.get(from) || [];
    list.push(to);
    membershipAdj.set(from, list);
  };

  // Direct privileged access marker + nested escalation path
  addEdge(nodes.privDir, nodes.target);
  addEdge(nodes.wrapper, nodes.target);
  addEdge(nodes.privNest, nodes.wrapper);

  // Dormant / toxic / excessive
  addEdge(nodes.dormPriv, adminGroups[0]);
  addEdge(nodes.toxic, adminGroups[0]);
  addEdge(nodes.toxic, adminGroups[1]);
  for (const g of adminGroups) addEdge(nodes.exPriv, g);

  const privilegeGroupIds = new Set([nodes.target, ...adminGroups]);
  const incomingByTarget = buildReverseAdjacency(membershipAdj);
  const getNeighbors = (nodeId) => membershipAdj.get(nodeId) || [];

  const scanGraph = {
    privilegeGroupIds,
    incomingByTarget,
    membershipAdj,
    privilegedGroupsReachable(userNodeId, maxDepth = 16) {
      if (!privilegeGroupIds.size) return [];
      const { visited } = bfsTraversal(userNodeId, getNeighbors, { maxDepth });
      return [...visited].filter((n) => privilegeGroupIds.has(n));
    },
    shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth = 12) {
      return shortestPath(userNodeId, targetGroupId, getNeighbors, { maxDepth });
    },
  };

  const users = [
    {
      user_id: "WIS-Sd-PrivDir",
      display_name: "WIS-Seed-Nested-Priv-Direct",
      rawData: { sAMAccountName: "WIS-Sd-PrivDir", userAccountControl: 512 },
    },
    {
      user_id: "WIS-Sd-PrivNest",
      display_name: "WIS-Seed-Nested-Priv-User",
      rawData: { sAMAccountName: "WIS-Sd-PrivNest", userAccountControl: 512 },
    },
    {
      user_id: "WIS-Sd-DormPriv",
      display_name: "WIS-Seed-Dormant-Privileged",
      // never logged on → dormant for privileged accounts
      rawData: {
        sAMAccountName: "WIS-Sd-DormPriv",
        userAccountControl: 512,
        lastLogonTimestamp: null,
      },
    },
    {
      user_id: "WIS-Sd-Toxic",
      display_name: "WIS-Seed-Toxic-Privilege",
      rawData: { sAMAccountName: "WIS-Sd-Toxic", userAccountControl: 512 },
    },
    {
      user_id: "WIS-Sd-ExPriv",
      display_name: "WIS-Seed-Excessive-Privilege",
      rawData: { sAMAccountName: "WIS-Sd-ExPriv", userAccountControl: 512 },
    },
  ];

  // Patch resolve path: detectors call resolveUserNodeFromDoc which needs matching IDs.
  // Our node IDs use USER:{user_id}; resolveUserNodeFromDoc builds from user_id similarly.
  const analysisCtx = {
    users,
    privilegedGroupsReachable: scanGraph.privilegedGroupsReachable,
    shortestPathToPrivileged: scanGraph.shortestPathToPrivileged,
  };

  return {
    tenantId,
    applicationId,
    scanId,
    scanGraph,
    analysisCtx,
    nodes,
    adminGroups,
  };
}

describe("isPrivilegedEntitlement name heuristics (no lab DN hardcoding)", () => {
  test("marks seed privileged group names via PRIVILEGED_NAME_TOKENS", () => {
    expect(
      isPrivilegedEntitlement({
        entitlement_name: "WIS-Seed-Privileged-Admin-01",
      }),
    ).toBe(true);
    expect(
      isPrivilegedEntitlement({
        entitlement_name: "WIS-Seed-Priv-Nested-Target-Admin",
      }),
    ).toBe(true);
    expect(
      isPrivilegedEntitlement({
        entitlement_name: "WIS-Seed-Priv-Nested-Wrapper",
      }),
    ).toBe(false);
  });
});

describe("Privileged Access detectors (seed-topology graph)", () => {
  test("nested privileged access is delegated to LDAP group module (no-op on graph)", async () => {
    const ctx = buildSeedLikeContext();
    const result = await discoverNestedPrivilegedAccess(ctx);
    expect(result.count).toBe(0);
    expect(result.feature).toBe("nested_privileged_access");
  });

  test("detects dormant privileged user with null lastLogonTimestamp", async () => {
    const ctx = buildSeedLikeContext();
    const result = await findDormantPrivilegedUsers(ctx);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some((f) => {
        const n = String(f.objectName);
        return n.includes("Dormant") || n.includes("DormPriv") || n.includes("dormpriv");
      }),
    ).toBe(true);
  });

  test("detects toxic privilege combinations (>= 2 privileged groups)", async () => {
    const ctx = buildSeedLikeContext();
    const userNode = `${ctx.tenantId}:${ctx.applicationId}:USER:wis-sd-toxic`;
    const reachable = ctx.scanGraph.privilegedGroupsReachable(userNode, 16);
    expect(reachable.length).toBeGreaterThanOrEqual(TOXIC_PRIVILEGE_MIN_GROUPS);
  });

  test("detects excessive privileges (>= 5 privileged groups)", async () => {
    const ctx = buildSeedLikeContext();
    const result = await detectExcessivePrivileges(ctx);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some((f) => {
        const n = String(f.objectName);
        return n.includes("Excessive") || n.includes("ExPriv") || n.includes("expriv");
      }),
    ).toBe(true);
  });

  test("detects privilege escalation path length >= 3 for PrivNest", async () => {
    const ctx = buildSeedLikeContext();
    const result = await findPrivilegeEscalationPaths(ctx);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some((f) => {
        const n = String(f.objectName);
        return n.includes("Nested-Priv-User") || n.includes("PrivNest") || n.includes("privnest");
      }),
    ).toBe(true);
  });
});
