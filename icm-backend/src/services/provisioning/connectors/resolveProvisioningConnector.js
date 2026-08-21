/**
 * Resolve a provisioning connector for an application via connector family.
 * No application-name branching (no if app === "SAP" / "AD").
 */

import mongoose from "mongoose";
import Application from "../../../models/application/Application.js";
import { getConnectorDefinition } from "../../../config/connectorCatalog.js";
import { createAdProvisioningConnector } from "./adProvisioningConnector.js";
import { createCsvTestProvisioningConnector } from "./csvTestProvisioningConnector.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

/**
 * Load application with optional tenant ownership check.
 * @returns {Promise<object|null>}
 */
export async function loadTenantApplication(applicationId, tenantId) {
  const oid = toOid(applicationId);
  if (!oid) return null;
  const q = { _id: oid };
  if (tenantId) {
    q.tenantId = toOid(tenantId) || tenantId;
  }
  return Application.findOne(q).lean();
}

/**
 * @param {string|import('mongoose').Types.ObjectId} applicationId
 * @param {{ tenantId?: string|import('mongoose').Types.ObjectId }} [opts]
 * @returns {Promise<{ executeTask: Function, createAccount: Function, family: string }|null>}
 */
export async function resolveProvisioningConnector(applicationId, opts = {}) {
  const application = await loadTenantApplication(applicationId, opts.tenantId);
  if (!application) return null;

  const def = getConnectorDefinition(application.connectorType, application.name || "");
  let family = def?.family || "none";

  // AD write path: family ldap_ad OR connectionConfig.ad present
  if (family === "ldap_ad" || application.connectionConfig?.ad) {
    return createAdProvisioningConnector({ application });
  }

  // Temporary Joiner test path for delimited/CSV applications (SAP/Oracle dummies, etc.)
  if (family === "file_delimited") {
    return createCsvTestProvisioningConnector({ application });
  }

  // Some test apps may only set name + userMappings without DelimitedFile code —
  // treat as CSV test connector only when explicitly opted in via connectionConfig.
  if (application.connectionConfig?.provisioningTestMode === "csv") {
    return createCsvTestProvisioningConnector({ application });
  }

  return null;
}
