import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { buildAclIntelligenceContext } from "./sidRegistry.js";

/**
 * Detect broken / stale ACL structures: orphan principals, invalid ACE targets, empty DACLs on sensitive objects.
 */
export async function detectBrokenAcls(ctx) {
  const { scanId, registry, securableObjects } = buildAclIntelligenceContext(ctx);
  const findings = [];
  const seen = new Set();

  for (const obj of securableObjects.values()) {
    const parsed = obj.parsedSd;
    if (!parsed) continue;

    const isSensitive =
      registry.isPrivilegedSid(obj.sid) ||
      /admin|privileged|schema|enterprise/i.test(obj.objectName);

    if (parsed.dacl?.present && parsed.dacl.aceCount > 0 && parsed.dacl.aces.length === 0) {
      const sig = `${obj.key}|invalid_ace_structure`;
      if (!seen.has(sig)) {
        seen.add(sig);
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "broken_acls",
            objectType: obj.objectType,
            objectName: obj.objectName,
            dn: obj.dn,
            status: "invalid_ace_structure",
            metadata: {
              expectedAceCount: parsed.dacl.aceCount,
              parsedAceCount: parsed.dacl.aces.length,
            },
            findingSignals: ["BROKEN_ACL"],
          }),
        );
      }
    }

    if (isSensitive && parsed.dacl?.present && parsed.dacl.aces.length === 0) {
      const sig = `${obj.key}|empty_dacl`;
      if (!seen.has(sig)) {
        seen.add(sig);
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "broken_acls",
            objectType: obj.objectType,
            objectName: obj.objectName,
            dn: obj.dn,
            status: "empty_dacl_on_sensitive_object",
            metadata: { ownerSid: parsed.ownerSid, groupSid: parsed.groupSid },
            findingSignals: ["BROKEN_ACL"],
          }),
        );
      }
    }

    for (const ace of obj.aces || []) {
      const sid = registry.normalizeSidString(ace.trusteeSid);
      if (!sid) {
        const sig = `${obj.key}|missing_trustee|${ace.offset}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "broken_acls",
            objectType: obj.objectType,
            objectName: obj.objectName,
            dn: obj.dn,
            status: "invalid_ace_target",
            metadata: {
              aclType: ace.aclType,
              aceType: ace.aceType,
              aceSize: ace.aceSize,
            },
            findingSignals: ["BROKEN_ACL"],
          }),
        );
        continue;
      }

      if (!registry.isKnown(sid)) {
        const sig = `${obj.key}|orphan|${sid}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "broken_acls",
            objectType: obj.objectType,
            objectName: obj.objectName,
            dn: obj.dn,
            status: "orphan_acl_principal",
            metadata: {
              orphanSid: sid,
              aclType: ace.aclType,
              accessMask: ace.accessMask,
              stalePermission: true,
            },
            findingSignals: ["BROKEN_ACL"],
          }),
        );
      }
    }
  }

  return { feature: "broken_acls", count: findings.length, findings };
}
