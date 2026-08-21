import SodAuditLog from "../../models/sod/SodAuditLog.js";
import { sodWithTenant } from "../../utils/sod/sodTenant.js";

/**
 * @param {{ scopedTenantId?: string | null, user?: { email?: string, id?: string } }} ctx
 */
export async function logSodAudit(ctx, entry) {
  try {
    await SodAuditLog.create(
      sodWithTenant(ctx.scopedTenantId, {
        ...entry,
        performedBy: entry.performedBy || ctx.user?.email || ctx.user?.id || "system",
        performedAt: entry.performedAt || new Date(),
        oldValue: entry.oldValue ? JSON.stringify(entry.oldValue) : undefined,
        newValue: entry.newValue ? JSON.stringify(entry.newValue) : undefined,
      }),
    );
  } catch {
    // non-blocking
  }
}
