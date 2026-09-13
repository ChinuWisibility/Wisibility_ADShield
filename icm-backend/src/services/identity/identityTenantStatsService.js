import mongoose from "mongoose";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import IdentityTenantStats from "../../models/identity/IdentityTenantStats.js";

export function toTenantObjectId(tenantId) {
  if (tenantId == null || tenantId === "") return null;
  const s = String(tenantId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * Recompute dashboard card counts for a tenant (single aggregation + upsert). Safe to call after bulk refresh.
 */
export async function recomputeIdentityTenantStats(tenantId) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) return null;
  const Identity = await getDynamicIdentityModelForTenantId(tid);

  const [agg] = await Identity.aggregate([
    { $match: { tenantId: tid } },
    {
      $facet: {
        total: [{ $count: "c" }],
        active: [{ $match: { lifecycleState: "ACTIVE" } }, { $count: "c" }],
        privileged: [
          {
            $match: {
              $or: [
                { riskLevel: { $in: ["HIGH", "CRITICAL"] } },
                { identityType: { $in: ["service", "vendor", "nhi"] } },
              ],
            },
          },
          { $count: "c" },
        ],
        inactive: [{ $match: { lifecycleState: { $ne: "ACTIVE" } } }, { $count: "c" }],
      },
    },
  ]);

  const total = agg?.total?.[0]?.c ?? 0;
  const active = agg?.active?.[0]?.c ?? 0;
  const privileged = agg?.privileged?.[0]?.c ?? 0;
  const inactive = agg?.inactive?.[0]?.c ?? 0;

  await IdentityTenantStats.findOneAndUpdate(
    { tenantId: tid },
    {
      $set: { total, active, privileged, inactive },
      $unset: { highRisk: "", contractors: "" },
    },
    { upsert: true, new: true },
  );

  return { total, active, privileged, inactive };
}
