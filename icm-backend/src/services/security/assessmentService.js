import AdSecurityAssessment, {
  AD_SECURITY_ASSESSMENT_STATUS,
} from "../../models/security/AdSecurityAssessment.js";
import PostureScanResult from "../../models/security/PostureScanResult.js";
import mongoose from "mongoose";
import {
  buildConfigurationFromApplication,
  workingConfigurationToApi,
} from "./assessmentVersionService.js";

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const s = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

export function assessmentToApi(doc, { includeWorkingConfiguration = false } = {}) {
  if (!doc) return null;
  const out = {
    assessmentId: String(doc._id),
    tenantId: doc.tenantId ? String(doc.tenantId) : null,
    applicationId: String(doc.applicationId),
    name: doc.name,
    description: doc.description || "",
    purpose: doc.purpose || "",
    ownerUserId: doc.ownerUserId ? String(doc.ownerUserId) : null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    status: doc.status,
    latestVersionId: doc.latestVersionId ? String(doc.latestVersionId) : null,
    latestVersionNumber:
      doc.latestVersionNumber != null ? Number(doc.latestVersionNumber) : null,
    latestExecutionId: doc.latestExecutionId || null,
    executionCount: doc.executionCount || 0,
    hasWorkingConfiguration: Boolean(doc.workingConfiguration),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  if (includeWorkingConfiguration) {
    out.workingConfiguration = workingConfigurationToApi(doc.workingConfiguration);
  }
  return out;
}

export async function listAssessmentsForApplication(applicationId, { limit = 50, skip = 0 } = {}) {
  const appId = toObjectId(applicationId);
  if (!appId) return { items: [], total: 0 };
  const filter = { applicationId: appId };
  const [docs, total] = await Promise.all([
    AdSecurityAssessment.find(filter)
      .sort({ updatedAt: -1 })
      .skip(Math.max(0, skip))
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
      .lean(),
    AdSecurityAssessment.countDocuments(filter),
  ]);
  return { items: docs.map((d) => assessmentToApi(d)), total };
}

export async function getAssessmentById(
  assessmentId,
  { applicationId, includeWorkingConfiguration = false } = {},
) {
  const id = toObjectId(assessmentId);
  if (!id) return null;
  const filter = { _id: id };
  if (applicationId) {
    const appId = toObjectId(applicationId);
    if (appId) filter.applicationId = appId;
  }
  const doc = await AdSecurityAssessment.findOne(filter).lean();
  return assessmentToApi(doc, { includeWorkingConfiguration });
}

export async function createAssessment({
  applicationId,
  tenantId,
  name,
  description = "",
  purpose = "",
  ownerUserId = null,
  createdBy = null,
}) {
  const appId = toObjectId(applicationId);
  if (!appId) throw new Error("applicationId is required");
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Assessment name is required");

  const workingConfiguration = await buildConfigurationFromApplication(appId, {
    source: "seeded_on_create",
  });
  workingConfiguration.updatedAt = new Date().toISOString();

  const doc = await AdSecurityAssessment.create({
    applicationId: appId,
    tenantId: toObjectId(tenantId),
    name: trimmedName,
    description: String(description || "").trim(),
    purpose: String(purpose || "").trim(),
    ownerUserId: toObjectId(ownerUserId) || toObjectId(createdBy),
    createdBy: toObjectId(createdBy),
    status: AD_SECURITY_ASSESSMENT_STATUS.CONFIGURED,
    workingConfiguration,
  });
  return assessmentToApi(doc.toObject(), { includeWorkingConfiguration: true });
}

export async function updateAssessment(assessmentId, patch = {}, { applicationId } = {}) {
  const id = toObjectId(assessmentId);
  if (!id) return null;
  const filter = { _id: id };
  if (applicationId) {
    const appId = toObjectId(applicationId);
    if (appId) filter.applicationId = appId;
  }

  const $set = {};
  if (patch.name !== undefined) {
    const n = String(patch.name || "").trim();
    if (!n) throw new Error("Assessment name is required");
    $set.name = n;
  }
  if (patch.description !== undefined) $set.description = String(patch.description || "").trim();
  if (patch.purpose !== undefined) $set.purpose = String(patch.purpose || "").trim();
  if (patch.ownerUserId !== undefined) $set.ownerUserId = toObjectId(patch.ownerUserId);
  if (patch.status !== undefined) {
    const allowed = Object.values(AD_SECURITY_ASSESSMENT_STATUS);
    if (!allowed.includes(patch.status)) throw new Error("Invalid assessment status");
    $set.status = patch.status;
  }

  const doc = await AdSecurityAssessment.findOneAndUpdate(
    filter,
    { $set },
    { new: true },
  ).lean();
  return assessmentToApi(doc);
}

export async function markAssessmentRunning(assessmentId) {
  const id = toObjectId(assessmentId);
  if (!id) return null;
  const doc = await AdSecurityAssessment.findByIdAndUpdate(
    id,
    { $set: { status: AD_SECURITY_ASSESSMENT_STATUS.RUNNING } },
    { new: true },
  ).lean();
  return assessmentToApi(doc);
}

export async function markAssessmentExecutionCompleted(assessmentId, executionId) {
  const id = toObjectId(assessmentId);
  if (!id) return null;
  const doc = await AdSecurityAssessment.findByIdAndUpdate(
    id,
    {
      $set: {
        status: AD_SECURITY_ASSESSMENT_STATUS.COMPLETED,
        latestExecutionId: executionId ? String(executionId) : null,
      },
      $inc: { executionCount: 1 },
    },
    { new: true },
  ).lean();
  return assessmentToApi(doc);
}

export async function attachOrphanScansToAssessment(assessmentId, applicationId) {
  const aId = toObjectId(assessmentId);
  const appId = toObjectId(applicationId);
  if (!aId || !appId) return { matched: 0, modified: 0 };

  const result = await PostureScanResult.updateMany(
    {
      applicationId: appId,
      $or: [{ assessmentId: null }, { assessmentId: { $exists: false } }],
    },
    { $set: { assessmentId: aId } },
  );

  const executionCount = await PostureScanResult.countDocuments({ assessmentId: aId });
  const latest = await PostureScanResult.findOne({ assessmentId: aId })
    .sort({ completedAt: -1 })
    .select("scanId")
    .lean();

  await AdSecurityAssessment.findByIdAndUpdate(aId, {
    $set: {
      executionCount,
      latestExecutionId: latest?.scanId || null,
      status:
        executionCount > 0
          ? AD_SECURITY_ASSESSMENT_STATUS.COMPLETED
          : AD_SECURITY_ASSESSMENT_STATUS.READY,
    },
  });

  return {
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
    executionCount,
  };
}

export { AD_SECURITY_ASSESSMENT_STATUS };
