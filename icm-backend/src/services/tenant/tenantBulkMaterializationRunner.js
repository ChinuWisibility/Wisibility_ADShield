import { runDelimitedIdentityRefresh } from "../identity/identityProfileRefreshService.js";

/** How many identity profiles to refresh in parallel (different source apps, separate queries). */
const BULK_PROFILE_CONCURRENCY = 3;

/**
 * Run identity refresh for each profile document (already filtered). All DB / CSV work stays on the server.
 * Does not recompute {@link recomputeIdentityTenantStats} — callers should schedule that (e.g. setImmediate) so
 * HTTP responses and job completion polling are not blocked by a full-tenant $facet.
 * @param {import('mongoose').Types.ObjectId} tenantOid
 * @param {object[]} usableProfiles - lean IdentityProfile docs with attributeMappings
 */
export async function runBulkTenantMaterializationProfiles(tenantOid, usableProfiles) {
  let totalUpserted = 0;
  let totalRows = 0;
  const errors = [];
  /** Per-profile hints from refresh (e.g. skipped correlation, PK mapping). */
  const hints = [];

  for (let i = 0; i < usableProfiles.length; i += BULK_PROFILE_CONCURRENCY) {
    const chunk = usableProfiles.slice(i, i + BULK_PROFILE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (p) => {
        try {
          const data = await runDelimitedIdentityRefresh(p);
          return { ok: true, p, data, err: null };
        } catch (e) {
          return { ok: false, p, data: null, err: e };
        }
      }),
    );
    for (const r of results) {
      if (!r.ok) {
        errors.push(`${r.p.name || "Profile"}: ${r.err?.message || "Refresh failed"}`);
        continue;
      }
      totalUpserted += r.data?.identitiesUpserted ?? 0;
      totalRows += r.data?.rowsProcessed ?? 0;
      if (r.data?.hint) {
        hints.push(`${r.p.name || "Profile"}: ${r.data.hint}`);
      }
    }
  }

  return {
    profilesProcessed: usableProfiles.length,
    identitiesUpserted: totalUpserted,
    rowsProcessed: totalRows,
    errors,
    hints,
    hintsText: hints.length ? hints.join("\n\n") : null,
  };
}
