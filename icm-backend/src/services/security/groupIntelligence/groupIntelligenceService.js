import { getDynamicEntitlementModelForTenantId } from "../../../models/application/Entitlements.js";
import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { resolveGroupNodeFromEntitlement } from "../../graph/graphNodeResolver.js";
import {
  isAdObjectInSearchScope,
  resolveGraphFeatureSearchBase,
} from "../../posture/graphSearchBaseScope.js";
import { GROUP_INTELLIGENCE_FEATURES } from "../../posture/postureFeatureIds.js";

export { GROUP_INTELLIGENCE_FEATURES };
function getAnalysis(ctx) {
  return ctx.analysisCtx;
}

function filterFindingsBySearchBase(ctx, featureId, findings) {
  const resolved = resolveGraphFeatureSearchBase(featureId, ctx);
  return (findings || []).filter((f) => isAdObjectInSearchScope(f.dn, resolved));
}

export async function findUnusedGroups(ctx) {
  const analysis = getAnalysis(ctx);

  if (analysis) {
    const findings = analysis.analyzeUnusedGroups();
    return { feature: "unused_groups", count: findings.length, findings };
  }

  const { tenantId, applicationId, application, scanId } = ctx;

  const EntitlementModel = await getDynamicEntitlementModelForTenantId(
    application.name,
    application.tenantId,
  );

  const findings = [];

  const cursor = EntitlementModel.find({ applicationId })
    .select("entitlement_id entitlement_name rawData")
    .lean()
    .cursor();

  for await (const ent of cursor) {
    const nodeId = resolveGroupNodeFromEntitlement(tenantId, applicationId, ent);
    if (!nodeId) continue;

    const rawMembers = ent?.rawData?.members || [];

    if (!rawMembers.length) {
      findings.push(
        buildGraphRiskFinding({
          scanId,
          feature: "unused_groups",
          objectType: "group",
          objectName: ent?.entitlement_name || nodeId,
          dn: ent?.rawData?.groupDN || "",
          status: "empty",
          findingSignals: ["UNUSED_GROUP"],
        }),
      );
    }
  }

  return { feature: "unused_groups", count: findings.length, findings };
}

export async function findGroupsWithoutOwners(ctx) {
  const analysis = getAnalysis(ctx);
  const entitlements = analysis?.entitlements;

  const { application, scanId } = ctx;
  const rows = entitlements || [];
  const findings = [];

  if (!entitlements) {
    const EntitlementModel = await getDynamicEntitlementModelForTenantId(
      application.name,
      application.tenantId,
    );
    const cursor = EntitlementModel.find({ applicationId: application._id })
      .select("entitlement_id entitlement_name rawData managedBy owner")
      .lean()
      .cursor();
    for await (const ent of cursor) rows.push(ent);
  }

  for (const ent of rows) {
    const raw = ent.rawData || {};
    const owner =
      ent.owner ||
      raw.managedBy ||
      raw.manager ||
      raw.owner ||
      raw.msExchCoManagedByLink;
    if (owner) continue;

    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: "groups_without_owners",
        objectType: "group",
        objectName: ent.entitlement_name || ent.entitlement_id,
        dn: raw.groupDN || raw.source_dn || "",
        status: "no_owner",
        findingSignals: ["GROUP_WITHOUT_OWNER"],
      }),
    );
  }

  return { feature: "groups_without_owners", count: findings.length, findings };
}

export async function analyzeNestedGroups(ctx) {
  const analysis = getAnalysis(ctx);
  if (analysis) {
    const { nestedFindings } = analysis.analyzeGroupStructure();
    return { feature: "nested_groups", count: nestedFindings.length, findings: nestedFindings };
  }
  return { feature: "nested_groups", count: 0, findings: [] };
}

export async function detectCircularMemberships(ctx) {
  const analysis = getAnalysis(ctx);
  if (analysis) {
    const { cycleFindings } = analysis.analyzeGroupStructure();
    return {
      feature: "circular_memberships",
      count: cycleFindings.length,
      findings: cycleFindings,
    };
  }
  return { feature: "circular_memberships", count: 0, findings: [] };
}

export async function findOrphanGroups(ctx) {
  const analysis = getAnalysis(ctx);
  const { tenantId, applicationId, scanId } = ctx;

  const unusedResult = await findUnusedGroups(ctx);
  const findings = analysis
    ? analysis.analyzeOrphanGroups(unusedResult.findings)
    : [];

  if (analysis) {
    return { feature: "orphan_groups", count: findings.length, findings };
  }

  for (const f of unusedResult.findings) {
    const groupNodeId = resolveGroupNodeFromEntitlement(tenantId, applicationId, {
      entitlement_name: f.objectName,
      rawData: { groupDN: f.dn },
    });
    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: "orphan_groups",
        objectType: "group",
        objectName: f.objectName,
        dn: f.dn,
        status: "orphan",
        findingSignals: ["ORPHAN_GROUP"],
      }),
    );
  }

  return { feature: "orphan_groups", count: findings.length, findings };
}

export async function findUsersInMultiplePrivilegedGroups(ctx) {
  const analysis = getAnalysis(ctx);
  const featureId = "toxic_privilege_combinations";
  let findings = [];
  if (analysis) {
    findings = analysis.analyzeToxicPrivilegeCombinations();
  }

  findings = filterFindingsBySearchBase(ctx, featureId, findings);

  if (!analysis) {
    const { scanGraph } = ctx;
    if (!scanGraph?.privilegeGroupIds?.size) {
      return { feature: featureId, count: 0, findings: [] };
    }
  }

  return {
    feature: featureId,
    count: findings.length,
    findings,
  };
}

export async function findDuplicateGroups(ctx) {
  const analysis = getAnalysis(ctx);
  if (analysis) {
    const findings = analysis.analyzeDuplicateGroups();
    return { feature: "duplicate_groups", count: findings.length, findings };
  }
  return { feature: "duplicate_groups", count: 0, findings: [] };
}

export async function runGroupIntelligence(ctx, features) {
  const selected = new Set(
    (features || GROUP_INTELLIGENCE_FEATURES).filter((f) =>
      GROUP_INTELLIGENCE_FEATURES.includes(f),
    ),
  );

  if (!selected.size) GROUP_INTELLIGENCE_FEATURES.forEach((f) => selected.add(f));

  const needsUnused =
    selected.has("unused_groups") || selected.has("orphan_groups");
  let unusedCache = null;

  const runners = {
    unused_groups: async () => {
      if (!unusedCache) unusedCache = await findUnusedGroups(ctx);
      return unusedCache;
    },

    groups_without_owners: findGroupsWithoutOwners,

    nested_groups: analyzeNestedGroups,

    circular_memberships: detectCircularMemberships,

    orphan_groups: async () => {
      if (!unusedCache) unusedCache = await findUnusedGroups(ctx);
      const analysis = getAnalysis(ctx);
      const findings = analysis
        ? analysis.analyzeOrphanGroups(unusedCache.findings)
        : (await findOrphanGroups(ctx)).findings;
      return { feature: "orphan_groups", count: findings.length, findings };
    },

    toxic_privilege_combinations: findUsersInMultiplePrivilegedGroups,

    duplicate_groups: findDuplicateGroups,
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
