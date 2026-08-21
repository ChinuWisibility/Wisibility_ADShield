import Application from "../models/application/Application.js";
import HrmsIntegration from "../models/integrations/HrmsIntegration.js";
import IdentityProfile from "../models/identity/IdentityProfile.js";

let migratedOnce = false;

/**
 * Copy legacy hrms_integrations into applications.hrms and re-point identity profiles (once per process).
 */
export async function migrateHrmsIntegrationsIntoApplicationsOnce() {
  if (migratedOnce) return;
  migratedOnce = true;

  const legacy = await HrmsIntegration.find().lean();
  if (!legacy.length) return;

  for (const h of legacy) {
    const exists = await Application.findOne({
      tenantId: h.tenantId,
      "hrms.migratedFromHrmsId": h._id,
    }).lean();
    if (exists) continue;

    const { _id: legacyId, tenantId, name, description, createdAt, updatedAt, updatedBy, ...hrmsRest } = h;

    await Application.create({
      tenantId,
      name: name || "HRMS",
      description: description || "",
      type: "erp",
      status: "active",
      integrationType: "connector",
      connectorType: h.connector === "delimited_file" ? "HRMS_DELIMITED_FILE" : "HRMS_ORANGEHRM",
      hrms: {
        ...hrmsRest,
        migratedFromHrmsId: legacyId,
      },
      createdBy: updatedBy || undefined,
      updatedBy: updatedBy || undefined,
      createdAt,
      updatedAt,
    });
  }

  for (const h of legacy) {
    const app = await Application.findOne({
      tenantId: h.tenantId,
      "hrms.migratedFromHrmsId": h._id,
    }).lean();
    if (!app) continue;

    await IdentityProfile.updateMany(
      { hrmsSourceId: h._id },
      { $set: { sourceApplicationId: app._id } }
    );

    const profiles = await IdentityProfile.find({
      $or: [{ hrmsSourceId: h._id }, { "attributeMappings.hrmsSourceId": h._id }],
    });
    for (const p of profiles) {
      if (p.hrmsSourceId && String(p.hrmsSourceId) === String(h._id)) {
        p.sourceApplicationId = app._id;
      }
      let changed = false;
      for (const m of p.attributeMappings || []) {
        if (m.hrmsSourceId && String(m.hrmsSourceId) === String(h._id)) {
          m.applicationId = app._id;
          m.hrmsSourceId = undefined;
          changed = true;
        }
      }
      if (changed) {
        p.markModified("attributeMappings");
        await p.save();
      }
    }
  }
}
