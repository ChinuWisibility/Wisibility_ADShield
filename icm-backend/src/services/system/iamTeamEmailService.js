import TenantConfig from "../../models/platform/TenantConfig.js";
import env from "../../config/env.js";

/**
 * Resolve IAM team inbox: tenant Org Settings first, then env/deployment fallback.
 */
export async function resolveIamTeamEmail(tenantId) {
  const candidates = [];
  if (tenantId != null && tenantId !== "") {
    candidates.push(String(tenantId));
  }
  for (const id of candidates) {
    const byId = await TenantConfig.findOne({ tenantId: id }).select("iamTeamEmail").lean();
    if (byId?.iamTeamEmail) return String(byId.iamTeamEmail).trim();
  }

  const any = await TenantConfig.findOne({
    iamTeamEmail: { $exists: true, $nin: [null, ""] },
  })
    .select("iamTeamEmail")
    .lean();
  if (any?.iamTeamEmail) return String(any.iamTeamEmail).trim();

  return String(env.workflow?.iamTeamEmail || process.env.IAM_TEAM_EMAIL || "").trim();
}
