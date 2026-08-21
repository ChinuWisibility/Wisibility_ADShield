import mongoose from "mongoose";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

/**
 * Queue a certification revoke for downstream provisioning (connector worker, V2).
 *
 * Creates a ProvisioningRequest + ProvisioningPlan + ProvisioningTask describing the
 * REMOVE_ENTITLEMENT operation. This is orchestration only: it records the intent and
 * the work item. It does NOT mutate IGA correlation/cube/account state or the target
 * system — that is the job of the future provisioning/connector worker. Verification of
 * actual removal is handled separately by re-reading the live identity entitlement view.
 */
export async function enqueueCertRevokeProvisioning({
  tenantId,
  executionId,
  reviewItemId,
  identityId,
  applicationId,
  applicationName,
  entitlementId,
  entitlementName,
  nativeIdentity,
  campaignName,
  requestedByEmail,
}) {
  const identityOid = toOid(identityId);
  const applicationOid = toOid(applicationId);
  if (!identityOid) {
    return { success: false, queued: false, error: "Invalid identityId for provisioning request" };
  }

  // Idempotent per execution: re-verify cycles must not spawn duplicate requests.
  const sourceId = executionId || (reviewItemId ? String(reviewItemId) : undefined);
  if (sourceId) {
    const existing = await ProvisioningRequest.findOne({
      sourceType: "CERTIFICATION",
      sourceId,
      status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS"] },
    }).lean();
    if (existing) {
      return {
        success: true,
        queued: true,
        reused: true,
        provisioningRequestId: String(existing._id),
      };
    }
  }

  const request = await ProvisioningRequest.create({
    requestType: "REVOKE",
    identityId: identityOid,
    justification:
      `Certification revoke — ${entitlementName || entitlementId || "entitlement"}` +
      (campaignName ? ` (campaign: ${campaignName})` : "") +
      (requestedByEmail ? ` requested by ${requestedByEmail}` : ""),
    status: "PENDING",
    priority: "HIGH",
    sourceType: "CERTIFICATION",
    sourceId: executionId || (reviewItemId ? String(reviewItemId) : undefined),
    approvalStatus: "NOT_REQUIRED",
    submittedAt: new Date(),
  });

  const operation = {
    operationType: "REMOVE_ENTITLEMENT",
    applicationId: applicationOid ? String(applicationOid) : undefined,
    applicationName: applicationName || undefined,
    entitlementId: entitlementId || undefined,
    entitlementName: entitlementName || undefined,
    nativeIdentity: nativeIdentity || undefined,
  };

  const plan = await ProvisioningPlan.create({
    requestId: request._id,
    identityId: identityOid,
    operations: [operation],
    totalOperations: 1,
    completedOperations: 0,
    failedOperations: 0,
    status: "COMPILED",
    compiledAt: new Date(),
  });

  let taskId = null;
  if (applicationOid) {
    const task = await ProvisioningTask.create({
      planId: plan._id,
      requestId: request._id,
      applicationId: applicationOid,
      operationType: "REMOVE_ENTITLEMENT",
      planItemId: `legacy:REMOVE_ENTITLEMENT:${String(applicationOid)}:${entitlementId || entitlementName || "unknown"}`,
      targetAttributes: {
        identityId: String(identityOid),
        entitlementId: entitlementId || undefined,
        entitlementName: entitlementName || undefined,
        nativeIdentity: nativeIdentity || undefined,
        applicationName: applicationName || undefined,
        reviewItemId: reviewItemId ? String(reviewItemId) : undefined,
        executionId: executionId || undefined,
        tenantId: tenantId ? String(tenantId) : undefined,
        planItemId: `legacy:REMOVE_ENTITLEMENT:${String(applicationOid)}:${entitlementId || entitlementName || "unknown"}`,
      },
      status: "PENDING",
    });
    taskId = String(task._id);
  }

  return {
    success: true,
    queued: true,
    provisioningRequestId: String(request._id),
    provisioningPlanId: String(plan._id),
    provisioningTaskId: taskId,
  };
}
