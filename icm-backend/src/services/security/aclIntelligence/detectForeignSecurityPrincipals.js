import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { buildAclIntelligenceContext } from "./sidRegistry.js";

function extractSourceDomain(dn, sid) {
  const fromDn = String(dn || "").match(/CN=([^,]+),CN=ForeignSecurityPrincipals/i);
  if (fromDn) return fromDn[1];
  const parts = String(sid || "").split("-");
  if (parts.length >= 8) {
    return `RID-domain-${parts[2]}-${parts[3]}-${parts[4]}-${parts[5]}`;
  }
  return "unknown";
}

/**
 * Discover foreign security principals and trust-related orphan references.
 */
export async function detectForeignSecurityPrincipals(ctx) {
  const { scanId, registry, securableObjects, entitlements, users } =
    buildAclIntelligenceContext(ctx);
  const findings = [];
  const seen = new Set();

  for (const obj of securableObjects.values()) {
    if (obj.objectType !== "foreign_security_principal") continue;
    const sig = obj.sid || obj.dn;
    if (!sig || seen.has(sig)) continue;
    seen.add(sig);

    const resolved = registry.resolve(obj.sid);
    const orphan = !resolved || !registry.isKnown(obj.sid);
    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: "foreign_security_principals",
        objectType: "foreign_security_principal",
        objectName: obj.objectName,
        dn: obj.dn,
        status: orphan ? "orphan_foreign_principal" : "foreign_principal",
        metadata: {
          sid: obj.sid,
          sourceDomain: extractSourceDomain(obj.dn, obj.sid),
          trustRelationship: "cross_domain_trust",
          orphan,
        },
        findingSignals: ["FOREIGN_SECURITY_PRINCIPAL"],
      }),
    );
  }

  // ACE references to foreign/unresolvable SIDs on local objects
  for (const obj of securableObjects.values()) {
    for (const ace of obj.aces || []) {
      const sid = registry.normalizeSidString(ace.trusteeSid);
      if (!sid || registry.isKnown(sid)) continue;
      if (!registry.isForeignSid(sid)) continue;
      const sig = `${obj.key}|${sid}|foreign_ace`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "foreign_security_principals",
          objectType: obj.objectType,
          objectName: obj.objectName,
          dn: obj.dn,
          status: "foreign_sid_ace_reference",
          metadata: {
            trusteeSid: sid,
            sourceDomain: extractSourceDomain("", sid),
            aclType: ace.aclType,
            accessMask: ace.accessMask,
            orphan: true,
          },
          findingSignals: ["FOREIGN_SECURITY_PRINCIPAL"],
        }),
      );
    }
  }

  // memberOf / membership hints referencing ForeignSecurityPrincipals container
  for (const user of users) {
    const raw = user.rawData || {};
    const memberOf = []
      .concat(raw.memberOf || [])
      .concat(user.member_of_entitlements || []);
    for (const dn of memberOf) {
      if (!/foreignsecurityprincipals/i.test(String(dn))) continue;
      const sig = `member|${user.user_id}|${dn}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "foreign_security_principals",
          objectType: "user",
          objectName: user.display_name || user.user_id,
          dn: raw.distinguishedName || "",
          status: "foreign_principal_membership",
          metadata: {
            foreignPrincipalDn: dn,
            sourceDomain: extractSourceDomain(dn, ""),
            trustRelationship: "cross_domain_trust",
          },
          findingSignals: ["FOREIGN_SECURITY_PRINCIPAL"],
        }),
      );
    }
  }

  // Unused entitlements that look like foreign principals but weren't indexed
  for (const ent of entitlements) {
    const raw = ent.rawData || {};
    const dn = raw.distinguishedName || raw.groupDN || "";
    if (!/foreignsecurityprincipals/i.test(dn)) continue;
    const sid = registry.normalizeSidString(raw.objectSid || raw.cn);
    if (seen.has(sid || dn)) continue;
    seen.add(sid || dn);
    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: "foreign_security_principals",
        objectType: "foreign_security_principal",
        objectName: ent.entitlement_name || ent.entitlement_id,
        dn,
        status: "foreign_principal",
        metadata: {
          sid,
          sourceDomain: extractSourceDomain(dn, sid),
          trustRelationship: "cross_domain_trust",
        },
        findingSignals: ["FOREIGN_SECURITY_PRINCIPAL"],
      }),
    );
  }

  return { feature: "foreign_security_principals", count: findings.length, findings };
}
