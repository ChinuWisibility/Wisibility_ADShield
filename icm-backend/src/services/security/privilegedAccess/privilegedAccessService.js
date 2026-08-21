import {
  EXCESSIVE_PRIVILEGE_THRESHOLD,
  GRAPH_EDGE_TYPES,
} from "../../graph/graphConstants.js";
import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { resolveUserNodeFromDoc } from "../../graph/graphNodeResolver.js";
import { classifyAccountStatusRaw } from "../../applicationUserStatusCountsService.js";
import { isOlderThanDays } from "../../posture/utils/adSecurityHelpers.js";
import {
  isAdObjectInSearchScope,
  resolveGraphFeatureSearchBase,
  resolveUserAdDn,
} from "../../posture/graphSearchBaseScope.js";
import { PRIVILEGED_ACCESS_FEATURES } from "../../posture/postureFeatureIds.js";

export { PRIVILEGED_ACCESS_FEATURES };

const DORMANT_PRIVILEGED_DAYS = 90;
const ESCALATION_USER_CAP = 500;

function getAnalysis(ctx) {
  return ctx.analysisCtx;
}

function privilegedReachable(ctx, userNodeId, maxDepth = 16) {
  const analysis = getAnalysis(ctx);
  if (analysis) return analysis.privilegedGroupsReachable(userNodeId, maxDepth);
  return ctx.scanGraph.privilegedGroupsReachable(userNodeId, maxDepth);
}

function shortestPrivPath(ctx, userNodeId, targetGroupId, maxDepth = 12) {
  const analysis = getAnalysis(ctx);
  if (analysis) return analysis.shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth);
  return ctx.scanGraph.shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth);
}

function userInSearchScope(ctx, featureId, user) {
  const resolved = resolveGraphFeatureSearchBase(featureId, ctx);
  return isAdObjectInSearchScope(resolveUserAdDn(user), resolved);
}

export async function discoverNestedPrivilegedAccess(_ctx) {
  // Nested privileged access is evaluated live via group_ldap_security
  // (Search Base + memberOf parity with test.ps1). Keep a no-op here so
  // older identity-graph scan paths do not double-count.
  return {
    feature: "nested_privileged_access",
    count: 0,
    findings: [],
  };
}

export async function findDormantPrivilegedUsers(ctx) {
  const { tenantId, applicationId, scanId } = ctx;
  const analysis = getAnalysis(ctx);
  const users = analysis?.users || [];
  const featureId = "dormant_privileged_users";
  const findings = [];

  for (const user of users) {
    if (!userInSearchScope(ctx, featureId, user)) continue;

    const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
    if (!userNodeId) continue;

    const privGroups = privilegedReachable(ctx, userNodeId, 16);
    if (!privGroups.length) continue;

    const raw = user.rawData || {};
    const uac = raw.userAccountControl || user.status;
    if (classifyAccountStatusRaw(uac) !== "active") continue;

    const lastLogon = raw.lastLogonTimestamp;
    // Never authenticated (null/0) counts as dormant for privileged accounts.
    const neverLoggedOn =
      lastLogon == null || lastLogon === "" || lastLogon === 0 || lastLogon === "0";
    if (!neverLoggedOn && !isOlderThanDays(lastLogon, DORMANT_PRIVILEGED_DAYS)) continue;

    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: featureId,
        objectType: "user",
        objectName: user.display_name || user.user_id,
        dn: resolveUserAdDn(user),
        status: `dormant_privileged_${DORMANT_PRIVILEGED_DAYS}d`,
        metadata: {
          inactiveDays: DORMANT_PRIVILEGED_DAYS,
          privilegedGroupCount: privGroups.length,
        },
        findingSignals: [
          "DORMANT_PRIVILEGED_USER",
          "PRIVILEGED_USER",
          "INACTIVE_USER",
        ],
      }),
    );
  }

  return {
    feature: featureId,
    count: findings.length,
    findings,
  };
}

export async function detectExcessivePrivileges(ctx) {
  const { tenantId, applicationId, scanId } = ctx;
  const analysis = getAnalysis(ctx);
  const users = analysis?.users || [];
  const featureId = "excessive_privileges";
  const findings = [];

  for (const user of users) {
    if (!userInSearchScope(ctx, featureId, user)) continue;

    const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
    if (!userNodeId) continue;

    const privCount = privilegedReachable(ctx, userNodeId, 16).length;
    if (privCount < EXCESSIVE_PRIVILEGE_THRESHOLD) continue;

    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: featureId,
        objectType: "user",
        objectName: user.display_name || user.user_id,
        dn: resolveUserAdDn(user),
        status: `privileged_paths_${privCount}`,
        metadata: { privilegedPathCount: privCount },
        findingSignals: ["EXCESSIVE_PRIVILEGES", "PRIVILEGED_USER"],
      }),
    );
  }

  return { feature: featureId, count: findings.length, findings };
}

export async function findPrivilegeEscalationPaths(ctx) {
  const { tenantId, applicationId, scanId, scanGraph } = ctx;
  const analysis = getAnalysis(ctx);
  const users = analysis?.users || [];
  const featureId = "privilege_escalation_paths";

  const privTargets = [...scanGraph.privilegeGroupIds].slice(0, 100);
  if (!privTargets.length) {
    return { feature: featureId, count: 0, findings: [] };
  }

  const findings = [];
  let processed = 0;

  for (const user of users) {
    if (processed >= ESCALATION_USER_CAP) break;
    processed += 1;

    if (!userInSearchScope(ctx, featureId, user)) continue;

    const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
    if (!userNodeId) continue;

    for (const target of privTargets) {
      const path = shortestPrivPath(ctx, userNodeId, target, 12);
      if (!path || path.length < 3) continue;

      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: featureId,
          objectType: "user",
          objectName: user.display_name || user.user_id,
          dn: resolveUserAdDn(user),
          status: "escalation_path",
          relationships: path.slice(0, -1).map((from, i) => ({
            from,
            to: path[i + 1],
            type: GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
          })),
          metadata: { pathLength: path.length, privilegedGroup: target },
          findingSignals: ["PRIVILEGE_ESCALATION_PATH", "PRIVILEGED_USER"],
        }),
      );
      break;
    }
  }

  return {
    feature: featureId,
    count: findings.length,
    findings,
  };
}

export async function runPrivilegedAccessIntelligence(ctx, features) {
  const selected = new Set(
    (features || PRIVILEGED_ACCESS_FEATURES).filter((f) =>
      PRIVILEGED_ACCESS_FEATURES.includes(f),
    ),
  );
  if (!selected.size) PRIVILEGED_ACCESS_FEATURES.forEach((f) => selected.add(f));

  const runners = {
    dormant_privileged_users: findDormantPrivilegedUsers,
    excessive_privileges: detectExcessivePrivileges,
    privilege_escalation_paths: findPrivilegeEscalationPaths,
  };

  const results = [];
  const allFindings = [];
  for (const [feature, fn] of Object.entries(runners)) {
    if (!selected.has(feature)) continue;
    const tFeat = Date.now();
    const r = await fn(ctx);
    results.push({ ...r, durationMs: Date.now() - tFeat });
    allFindings.push(...(r.findings || []));
  }

  return { results, findings: allFindings };
}
