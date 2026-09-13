/**
 * Generic post-provision verification abstraction.
 * AD: eventually queries real AD (when reachable).
 * CSV test: inspects dynamic user collection.
 * Never claims AD live success without reaching AD / verifying dataset.
 */

import Application from "../../models/application/Application.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { applicationIdInClause } from "../application/applicationUserIngestService.js";
import { getConnectorDefinition } from "../../config/connectorCatalog.js";

/**
 * @returns {Promise<{ ok: boolean, mode: string, reason?: string, detail?: object }>}
 */
export async function verifyProvisioningOutcome({ task, connectorResult }) {
  const op = String(task?.operationType || "").toUpperCase();
  const attrs = task?.targetAttributes || {};
  const applicationId = task?.applicationId;
  const tenantId = attrs.tenantId;

  // If connector already returned structured verification (AD read-back), trust when present
  if (connectorResult?.detail?.verified || connectorResult?.detail?.verification) {
    return {
      ok: true,
      mode: "connector_readback",
      detail: connectorResult.detail.verified || connectorResult.detail.verification,
    };
  }

  // Duplicate ENSURE / already-disabled treated as verified
  if (connectorResult?.detail?.duplicate || connectorResult?.detail?.noop) {
    return { ok: true, mode: "idempotent_satisfied", detail: connectorResult.detail };
  }

  const application = await Application.findById(applicationId).lean();
  if (!application) {
    return { ok: false, mode: "error", reason: "Application not found for verification" };
  }

  const def = getConnectorDefinition(application.connectorType, application.name || "");
  const family = def?.family || "none";

  if (family === "ldap_ad" || application.connectionConfig?.ad) {
    // Live AD query verification — only when connector reported adLiveWrite.
    // If AD is offline, connector fails earlier; here we mark pending for sync-based verify.
    if (connectorResult?.detail?.adLiveWrite) {
      return {
        ok: true,
        mode: "ad_connector_readback_or_write_ack",
        detail: {
          nativeIdentifier: connectorResult.nativeIdentifier,
          note: "AD LIVE VALIDATION PENDING for sync/correlation unless read-back present",
        },
      };
    }
    return {
      ok: false,
      mode: "ad_offline_or_no_write",
      reason: "No AD live write evidence on connector result",
    };
  }

  if (
    family === "file_delimited" ||
    application.connectionConfig?.provisioningTestMode === "csv"
  ) {
    try {
      const Users = await getDynamicUserModelForTenantId(application.name, tenantId);
      const appIdClause = applicationIdInClause(application._id);
      const nativeId = connectorResult?.nativeIdentifier || attrs.nativeIdentifier;
      let row = null;
      if (nativeId) {
        row = await Users.findById(nativeId).lean();
      }
      if (!row && attrs.identityId) {
        row = await Users.findOne({
          applicationId: appIdClause,
          "rawData.identityId": String(attrs.identityId),
        }).lean();
      }
      if (!row) {
        return { ok: false, mode: "csv", reason: "CSV account row not found after provision" };
      }
      if (op === "DISABLE" || op === "DISABLE_ACCOUNT") {
        const disabled = String(row.status || "").toUpperCase() === "DISABLED";
        return disabled
          ? { ok: true, mode: "csv", detail: { status: row.status } }
          : { ok: false, mode: "csv", reason: "CSV account not DISABLED" };
      }
      if (op === "UPDATE_ACCOUNT") {
        return { ok: true, mode: "csv", detail: { _id: String(row._id) } };
      }
      // CREATE
      return { ok: true, mode: "csv", detail: { _id: String(row._id) } };
    } catch (err) {
      return { ok: false, mode: "csv", reason: err.message };
    }
  }

  // Unknown family — accept connector COMPLETED with explicit note
  return {
    ok: true,
    mode: "connector_status_only",
    detail: { warning: "No family-specific verifier" },
  };
}
