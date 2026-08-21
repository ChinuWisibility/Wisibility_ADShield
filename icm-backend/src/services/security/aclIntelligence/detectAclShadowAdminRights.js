import { PRIVILEGED_NAME_TOKENS } from "../../graph/graphConstants.js";
import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { resolveUserNodeFromDoc } from "../../graph/graphNodeResolver.js";
import {
  describeDangerousRights,
  hasShadowAdminRights,
} from "./aceConstants.js";
import { buildAclIntelligenceContext } from "./sidRegistry.js";
import {
  isAdObjectInSearchScope,
  resolveGraphFeatureSearchBase,
  resolveUserAdDn,
} from "../../posture/graphSearchBaseScope.js";

function isAdminTargetName(name) {
  const n = String(name || "").toLowerCase();
  return PRIVILEGED_NAME_TOKENS.some((t) => n.includes(t.replace(/\s/g, "")));
}

function shadowAdminInScope(ctx, user) {
  const resolved = resolveGraphFeatureSearchBase("shadow_admins", ctx);
  return isAdObjectInSearchScope(resolveUserAdDn(user), resolved);
}

/**
 * ACL-derived shadow admin paths: non-privileged users/grants with takeover rights on admin objects.
 * @param {object} ctx
 * @returns {Promise<{ feature: string, count: number, findings: object[] }>}
 */
export async function detectAclShadowAdminRights(ctx) {
  const { tenantId, applicationId, scanId, scanGraph, registry, securableObjects, users } =
    buildAclIntelligenceContext(ctx);
  const findings = [];
  const seen = new Set();

  const userSidToDoc = new Map();
  for (const user of users) {
    const sid = registry.normalizeSidString(user.rawData?.objectSid);
    if (sid) userSidToDoc.set(sid, user);
  }

  for (const obj of securableObjects.values()) {
    if (!isAdminTargetName(obj.objectName) && !registry.isPrivilegedSid(obj.sid)) continue;

    for (const ace of obj.aces || []) {
      if (!ace.isAllowed || !hasShadowAdminRights(ace.accessMask)) continue;
      const trusteeSid = registry.normalizeSidString(ace.trusteeSid);
      if (!trusteeSid) continue;

      const trustee = registry.resolve(trusteeSid);
      const user = userSidToDoc.get(trusteeSid);
      if (!user) continue;
      if (!shadowAdminInScope(ctx, user)) continue;

      const raw = user.rawData || {};
      const explicitAdmin =
        String(raw.is_privileged || user.is_privileged || "").toLowerCase() === "true" ||
        registry.isPrivilegedSid(trusteeSid);
      if (explicitAdmin) continue;

      const sig = `${trusteeSid}|${obj.key}|${ace.accessMask}`;
      if (seen.has(sig)) continue;
      seen.add(sig);

      const rights = describeDangerousRights(ace.accessMask);
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "shadow_admins",
          objectType: "user",
          objectName: user.display_name || user.user_id,
          dn: raw.distinguishedName || "",
          status: "acl_derived_shadow_admin",
          findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
          relationships: [
            {
              type: "ACL_GRANT",
              source: user.display_name || user.user_id,
              target: obj.objectName,
              rights,
            },
          ],
          metadata: {
            detection: "acl_derived_privilege_path",
            trusteeSid,
            targetSid: obj.sid,
            targetDn: obj.dn,
            targetType: obj.objectType,
            accessMask: ace.accessMask,
            rights,
            aclType: ace.aclType,
          },
        }),
      );
    }
  }

  return { feature: "shadow_admins_acl", count: findings.length, findings };
}

/**
 * Graph heuristic shadow admins (existing behavior) — kept separate for composition.
 */
export async function detectGraphShadowAdmins(ctx) {
  const { tenantId, applicationId, scanId, scanGraph } = ctx;
  const analysis = ctx.analysisCtx;
  const users = analysis?.users || [];

  const adminTargets = [...scanGraph.privilegeGroupIds].filter((id) =>
    PRIVILEGED_NAME_TOKENS.some((t) =>
      String(id).toLowerCase().includes(t.replace(/\s/g, "")),
    ),
  );

  if (!adminTargets.length) {
    return [];
  }

  const adminSet = new Set(adminTargets);
  const findings = [];

  for (const user of users) {
    if (!shadowAdminInScope(ctx, user)) continue;

    const raw = user.rawData || {};
    const explicitAdmin =
      String(raw.is_privileged || user.is_privileged || "").toLowerCase() === "true";
    if (explicitAdmin) continue;

    const userNodeId = resolveUserNodeFromDoc(tenantId, applicationId, user);
    if (!userNodeId) continue;

    const reachable = analysis
      ? analysis.privilegedGroupsReachable(userNodeId, 16)
      : scanGraph.privilegedGroupsReachable(userNodeId, 16);
    const hit = reachable.some((n) => adminSet.has(n));
    if (!hit) continue;

    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: "shadow_admins",
        objectType: "user",
        objectName: user.display_name || user.user_id,
        dn: raw.distinguishedName || "",
        status: "indirect_admin_capability",
        metadata: { detection: "nested_privileged_path" },
        findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
      }),
    );
  }

  return findings;
}
