/**
 * Non-blocking triggers for identity entitlement projection sync.
 * Keeps correlation controllers free of direct sync import cycles at module load.
 */

const LOG_PREFIX = "[identityEntitlementSyncTrigger]";

function runSafely(label, fn) {
  setImmediate(() => {
    void (async () => {
      try {
        const mod = await import("../services/identity/identityEntitlementSyncService.js");
        await fn(mod);
      } catch (err) {
        console.error(LOG_PREFIX, label, err?.message || err);
      }
    })();
  });
}

/**
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 */
export function scheduleSyncAllForApplication(applicationId) {
  if (applicationId == null || String(applicationId).trim() === "") return;
  runSafely("syncAllForApplication", (mod) => mod.syncAllForApplication(applicationId));
}

/**
 * @param {import('mongoose').Types.ObjectId|string} identityId
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 */
export function scheduleSyncForIdentity(identityId, applicationId) {
  if (identityId == null || applicationId == null) return;
  runSafely("syncForIdentity", (mod) => mod.syncForIdentity(identityId, applicationId));
}

/**
 * Sync a subset of identities for one application.
 * Shares a single entitlement catalog load across the batch.
 * Do NOT call this in addition to scheduleSyncAllForApplication for the same app —
 * syncAll already covers every identity.
 *
 * @param {Iterable<import('mongoose').Types.ObjectId|string>} identityIds
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 */
export function scheduleSyncForIdentities(identityIds, applicationId) {
  if (applicationId == null) return;
  const uniq = [...new Set([...identityIds].map(String))].filter(Boolean);
  if (!uniq.length) return;
  runSafely("syncForIdentities", (mod) => mod.syncForIdentities(uniq, applicationId));
}
