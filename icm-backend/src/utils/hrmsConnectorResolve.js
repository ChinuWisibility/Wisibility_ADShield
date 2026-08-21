import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import HrmsIntegration from "../models/integrations/HrmsIntegration.js";
import {
  connectorTypeImpliesHrmsDelimited,
  inferDelimitedFileConnector,
} from "./hrmsDelimitedConnectorTypes.js";

function flattenApplicationHrms(app) {
  const h = app.hrms || {};
  /** Catalog stub may omit `hrms.connector` until first save — infer delimited CSV for preview/import. */
  let connector = h.connector;
  if (!connector) {
    const inferred = inferDelimitedFileConnector(app.connectorType);
    if (inferred) connector = inferred;
  }
  return {
    kind: "application",
    _id: app._id,
    tenantId: app.tenantId,
    name: app.name,
    description: app.description,
    connector,
    isActive: h.isActive !== false,
    connectionStatus: h.connectionStatus,
    delimitedCsvHeaders: h.delimitedCsvHeaders || [],
    delimitedPreviewRows: h.delimitedPreviewRows || [],
    delimitedImportRows: h.delimitedImportRows || [],
    delimitedRowCount: h.delimitedRowCount,
    baseUrl: h.baseUrl,
    clientId: h.clientId,
    clientSecret: h.clientSecret,
    accessToken: h.accessToken,
    refreshToken: h.refreshToken,
    tokenExpiresAt: h.tokenExpiresAt,
    employeesApiPath: h.employeesApiPath,
    authorizePath: h.authorizePath,
    tokenPath: h.tokenPath,
    directoryTargetApplicationId: h.directoryTargetApplicationId,
  };
}

/**
 * Resolve an App Registry application with embedded hrms config, or a legacy hrms_integrations row.
 * Accepts either an application _id or a legacy hrms_integrations _id (after migration, resolves to the app).
 */
export async function resolveHrmsIntegrationRecord(tenantId, id) {
  if (!tenantId || !id || !mongoose.Types.ObjectId.isValid(String(id))) return null;

  const appById = await Application.findOne({ _id: id, tenantId }).lean();
  if (appById?.hrms?.connector) {
    return flattenApplicationHrms(appById);
  }
  /** Delimited catalog app before first `hrms.connector` write — still has CSV rows + schema. */
  if (appById && !appById.hrms?.connector && inferDelimitedFileConnector(appById.connectorType)) {
    return flattenApplicationHrms(appById);
  }
  if (
    appById &&
    !appById.hrms?.connector &&
    connectorTypeImpliesHrmsDelimited(appById.connectorType)
  ) {
    await Application.updateOne(
      { _id: appById._id, tenantId },
      { $set: { "hrms.connector": "delimited_file" } }
    );
    const refreshed = await Application.findOne({ _id: id, tenantId }).lean();
    if (refreshed?.hrms?.connector) {
      return flattenApplicationHrms(refreshed);
    }
  }

  const migrated = await Application.findOne({ tenantId, "hrms.migratedFromHrmsId": id }).lean();
  if (migrated?.hrms?.connector) {
    return flattenApplicationHrms(migrated);
  }

  const leg = await HrmsIntegration.findOne({ _id: id, tenantId }).lean();
  if (leg) {
    const appFromLeg = await Application.findOne({ tenantId, "hrms.migratedFromHrmsId": leg._id }).lean();
    if (appFromLeg?.hrms?.connector) {
      return flattenApplicationHrms(appFromLeg);
    }
    return { kind: "legacy", ...leg };
  }

  return null;
}
