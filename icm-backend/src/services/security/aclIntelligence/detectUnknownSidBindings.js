import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { buildAclIntelligenceContext } from "./sidRegistry.js";

/**
 * Detect ACL ACE trustee SIDs that cannot be resolved in the synced directory catalog.
 */
export async function detectUnknownSidBindings(ctx) {
  const { scanId, registry, securableObjects } = buildAclIntelligenceContext(ctx);
  const findings = [];
  const seen = new Set();

  for (const obj of securableObjects.values()) {
    const parsed = obj.parsedSd;
    if (!parsed) continue;

    const principalSids = [
      { sid: parsed.ownerSid, role: "owner" },
      { sid: parsed.groupSid, role: "group" },
    ];

    for (const { sid, role } of principalSids) {
      const norm = registry.normalizeSidString(sid);
      if (!norm || registry.isKnown(norm)) continue;
      const sig = `${obj.key}|${role}|${norm}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "unknown_sid_bindings",
          objectType: obj.objectType,
          objectName: obj.objectName,
          dn: obj.dn,
          status: "unknown_descriptor_principal",
          metadata: {
            unresolvedSid: norm,
            bindingRole: role,
            descriptorRevision: parsed.revision,
          },
          findingSignals: ["UNKNOWN_SID_BINDING"],
        }),
      );
    }

    for (const ace of obj.aces || []) {
      const sid = registry.normalizeSidString(ace.trusteeSid);
      if (!sid || registry.isKnown(sid)) continue;
      const sig = `${obj.key}|ace|${sid}|${ace.accessMask}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "unknown_sid_bindings",
          objectType: obj.objectType,
          objectName: obj.objectName,
          dn: obj.dn,
          status: "unknown_ace_trustee",
          metadata: {
            unresolvedSid: sid,
            aclType: ace.aclType,
            aceType: ace.aceType,
            accessMask: ace.accessMask,
            aceFlags: ace.aceFlags,
          },
          findingSignals: ["UNKNOWN_SID_BINDING"],
        }),
      );
    }
  }

  return { feature: "unknown_sid_bindings", count: findings.length, findings };
}
