import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import ApplicationUserDuplicate from "../models/application/ApplicationUserDuplicate.js";
import { applicationIdInClause } from "../services/applicationUserIngestService.js";
import { summarizeDuplicateAccountForDisplay } from "../utils/datahygine/duplicateAccountDisplayEnrichment.js";

function toOid(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

/**
 * GET /applications/:id/user-duplicates — list duplicate PK groups for this application.
 */
export async function listApplicationUserDuplicates(req, res) {
  try {
    const applicationId = toOid(req.params.id);
    if (!applicationId) {
      return res.status(400).json({ success: false, message: "Invalid application id." });
    }
    const app = await Application.findById(applicationId)
      .select("tenantId userMappings csvImportMapping")
      .lean();
    if (!app) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const appSchema = {
      userMappings: app.userMappings || [],
      csvImportMapping: app.csvImportMapping || null,
    };

    const rawPage = parseInt(String(req.query.page ?? "0"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;
    const skip = page * limit;

    const filter = { applicationId: applicationIdInClause(applicationId) };
    const [total, data] = await Promise.all([
      ApplicationUserDuplicate.countDocuments(filter),
      ApplicationUserDuplicate.find(filter)
        .sort({ observedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      success: true,
      data: data.map((d) => ({
        groupId: String(d._id),
        primaryKeyField: d.primaryKeyField,
        primaryKeyValue: d.primaryKeyValue,
        primaryKeyNormalized: d.primaryKeyNormalized,
        displayName: summarizeDuplicateAccountForDisplay(d, appSchema).displayName || "",
        duplicateCount: d.duplicateCount,
        canonicalization: d.canonicalization,
        observedAt: d.observedAt,
        source: d.source,
      })),
      page,
      limit,
      total,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || "Failed to list duplicates." });
  }
}

/**
 * GET /applications/:id/user-duplicates/:groupId — one duplicate group (full snapshot payload).
 */
export async function getApplicationUserDuplicateById(req, res) {
  try {
    const applicationId = toOid(req.params.id);
    const groupId = toOid(req.params.groupId);
    if (!applicationId || !groupId) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const doc = await ApplicationUserDuplicate.findOne({
      _id: groupId,
      applicationId: applicationIdInClause(applicationId),
    }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: "Duplicate group not found." });
    }
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || "Failed to load duplicate group." });
  }
}
