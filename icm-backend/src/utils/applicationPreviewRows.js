import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import { getDynamicUserModelForTenantId } from "../models/application/Users.js";
import { accountDocToCsvRow } from "./identityProfileMappingUtils.js";
import { resolveHrmsIntegrationRecord } from "./hrmsConnectorResolve.js";

function pickDelimitedSampleRows(rec) {
  if (!rec) return [];
  const full =
    rec.delimitedImportRows?.length > 0 ? rec.delimitedImportRows : rec.delimitedPreviewRows || [];
  return full;
}

/**
 * Application document with schema for a mapping source (mapping row app first, else profile source).
 * Shared by mapping preview and GET delimited-schema.
 */
export async function resolveApplicationDocForPreview(tenantId, mappingAppRef, profileSourceId) {
  if (mappingAppRef && mongoose.Types.ObjectId.isValid(String(mappingAppRef))) {
    const app = await Application.findOne({ _id: mappingAppRef, tenantId }).select("name userMappings tenantId").lean();
    if (app?.userMappings?.length) return app;
  }
  if (profileSourceId && mongoose.Types.ObjectId.isValid(String(profileSourceId))) {
    const fb = await Application.findOne({ _id: profileSourceId, tenantId }).select("name userMappings tenantId").lean();
    if (fb?.userMappings?.length) return fb;
  }
  return null;
}

/**
 * Sample rows: materialized Application users (same as Application → Users), then delimited HRMS, then Application.hrms.
 * Row sourcing does not depend on identity profile mappingSourceMode (resolution still does).
 *
 * @param {object} [options]
 * @param {number} [options.limit=50]
 */
export async function loadPreviewSampleRows(tenantId, appRef, appDoc, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 50;
  const rec = await resolveHrmsIntegrationRecord(tenantId, appRef);
  let pr = [];

  if (appDoc?.userMappings?.length && appDoc?.name) {
    try {
      const UsersModel = await getDynamicUserModelForTenantId(appDoc.name, appDoc.tenantId);
      const accountDocs = await UsersModel.find({ applicationId: appDoc._id }).limit(limit).lean();
      if (accountDocs.length > 0) {
        pr = accountDocs.map((d) => accountDocToCsvRow(d, appDoc.userMappings));
      }
    } catch (e) {
      console.error("loadPreviewSampleRows: materialized users failed", e);
    }
  }

  if (!pr.length) {
    pr = pickDelimitedSampleRows(rec);
  }
  if (!pr.length && appRef && mongoose.Types.ObjectId.isValid(String(appRef))) {
    const appRec = await Application.findOne({ _id: appRef, tenantId }).select("hrms").lean();
    const appRows =
      appRec?.hrms?.delimitedImportRows?.length > 0
        ? appRec.hrms.delimitedImportRows
        : appRec?.hrms?.delimitedPreviewRows || [];
    pr = appRows;
  }

  return { pr, rec };
}
