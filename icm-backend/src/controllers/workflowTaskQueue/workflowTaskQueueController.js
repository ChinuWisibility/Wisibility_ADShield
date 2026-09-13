import * as ruleService from "../../services/workflowTaskQueue/remediationWorkflowRuleService.js";
import * as queueService from "../../services/workflowTaskQueue/workflowTaskQueueService.js";
import { WORKFLOW_TASK_ACTIONS } from "../../constants/workflowTaskQueue.js";

function buildEnqueueFailureMessage(action, results = []) {
  const reasons = results.reduce((acc, row) => {
    const key = row.reason || (row.created ? "created" : "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  if (reasons.no_workflow_mapping) {
    if (action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW) {
      return (
        "No IAM orphan workflow is mapped. Open Global Rule Set → Remediation workflow rules " +
        'and map IAM Orphan Review to "Uncorrelated Account — IAM Decision" (or another enabled workflow).'
      );
    }
    return "No workflow mapped for this remediation action in Global Rule Set → Remediation workflow rules.";
  }

  if (reasons.invalid_workflow) {
    return "The selected workflow is not enabled or could not be found. Choose another workflow or update Global Rule Set.";
  }

  if (reasons.no_workflow_mapping && action === WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE) {
    return (
      "No access revoke workflow is mapped. Open Global Rule Set → Remediation workflow rules " +
      "and map Access Revoke to a Certification Signed Off workflow."
    );
  }

  if (reasons.not_found || reasons.invalid_id) {
    return "Selected account(s) were not found for this tenant. Refresh the list and try again.";
  }

  if (reasons.missing_context) {
    return "Remediation context was incomplete. Refresh and try again.";
  }

  return "No tasks could be queued. Check Global Rule Set mapping and that the selected records are still valid.";
}

export async function getRemediationWorkflowRules(req, res, next) {
  try {
    const data = await ruleService.getRemediationWorkflowRules(req.scopedTenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function putRemediationWorkflowRules(req, res, next) {
  try {
    if (!req.scopedTenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }
    const data = await ruleService.putRemediationWorkflowRules(
      req.scopedTenantId,
      req.body?.actionMappings || [],
      req.user?.email,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function listWorkflowTasks(req, res, next) {
  try {
    if (!req.scopedTenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }
    const data = await queueService.listWorkflowTasks(req.scopedTenantId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowTask(req, res, next) {
  try {
    const data = await queueService.getWorkflowTask(req.params.taskId, req.scopedTenantId);
    if (!data) return res.status(404).json({ success: false, message: "Task not found" });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowTaskSummary(req, res, next) {
  try {
    if (!req.scopedTenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }
    const data = await queueService.getWorkflowTaskSummary(req.scopedTenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function checkIamOrphanQueued(req, res, next) {
  try {
    if (!req.scopedTenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }
    const raw = req.query.orphanIds || req.query.targetIds || "";
    const orphanIds = String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await queueService.getQueuedOrphanTargetsMap(req.scopedTenantId, orphanIds);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function enqueueIamOrphanReview(req, res, next) {
  try {
    if (!req.scopedTenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }
    const orphanIds = Array.isArray(req.body?.orphanIds)
      ? req.body.orphanIds
      : req.body?.targetIds;
    if (!Array.isArray(orphanIds) || orphanIds.length === 0) {
      return res.status(400).json({ success: false, message: "orphanIds required" });
    }
    const data = await queueService.enqueueIamOrphanReviewTasks({
      tenantId: req.scopedTenantId,
      orphanIds,
      createdBy: req.user?.email || "Uncorrelated Accounts",
      workflowId: req.body?.workflowId ? String(req.body.workflowId).trim() : null,
    });
    if (!data.createdCount && data.duplicateCount === orphanIds.length) {
      return res.status(200).json({
        success: true,
        data: {
          ...data,
          duplicate: true,
          message: "All selected records are already in the remediation queue",
        },
      });
    }
    if (!data.createdCount && !data.duplicateCount) {
      return res.status(422).json({
        success: false,
        message: buildEnqueueFailureMessage(WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW, data.results),
        data: {
          results: data.results,
        },
      });
    }
    res.status(data.createdCount ? 201 : 200).json({
      success: true,
      data: {
        ...data,
        created: data.createdCount > 0,
        message:
          data.createdCount > 0
            ? `${data.createdCount} task(s) added to remediation queue`
            : "Some records were already queued",
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function enqueueAccessRevoke(req, res, next) {
  try {
    if (!req.scopedTenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: "items required (reviewItemId, optional entitlementName)" });
    }
    const data = await queueService.enqueueAccessRevokeTasks({
      tenantId: req.scopedTenantId,
      items,
      createdBy: req.user?.email || "Certification Review",
      workflowId: req.body?.workflowId ? String(req.body.workflowId).trim() : null,
    });
    if (!data.createdCount && data.duplicateCount === items.length) {
      return res.status(200).json({
        success: true,
        data: {
          ...data,
          duplicate: true,
          message: "All selected records are already in the remediation queue",
        },
      });
    }
    if (!data.createdCount && !data.duplicateCount) {
      return res.status(422).json({
        success: false,
        message: buildEnqueueFailureMessage(WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE, data.results),
        data: { results: data.results },
      });
    }
    res.status(data.createdCount ? 201 : 200).json({
      success: true,
      data: {
        ...data,
        created: data.createdCount > 0,
        message:
          data.createdCount > 0
            ? `${data.createdCount} task(s) added to remediation queue`
            : "Some records were already queued",
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function immediatelyLaunchTaskHandler(req, res, next) {
  try {
    const data = await queueService.immediatelyLaunchTask(
      req.params.taskId,
      req.scopedTenantId,
      req.user?.email || "system"
    );
    res.status(202).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function retryFailedNotificationsHandler(req, res, next) {
  try {
    const data = await queueService.retryFailedNotifications(
      req.params.taskId,
      req.scopedTenantId,
      req.user?.email || "system",
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function markTaskCompleteHandler(req, res, next) {
  try {
    const data = await queueService.markTaskComplete(
      req.params.taskId,
      req.scopedTenantId,
      req.user?.email || "system",
    );
    res.status(200).json({ success: true, data, message: "Task marked complete" });
  } catch (err) {
    const message = err?.message || "Failed to mark task complete";
    if (/not found/i.test(message)) {
      return res.status(404).json({ success: false, message });
    }
    if (/cannot mark|already/i.test(message)) {
      return res.status(409).json({ success: false, message });
    }
    next(err);
  }
}

export async function cancelWorkflowTaskHandler(req, res, next) {
  try {
    const data = await queueService.cancelWorkflowTask(
      req.params.taskId,
      req.scopedTenantId,
      req.user?.email || "system",
      { reason: req.body?.reason },
    );
    res.status(200).json({
      success: true,
      data,
      message: "Task cancelled — access was not revoked",
    });
  } catch (err) {
    const message = err?.message || "Failed to cancel task";
    if (/not found/i.test(message)) {
      return res.status(404).json({ success: false, message });
    }
    if (/cannot cancel|already/i.test(message)) {
      return res.status(409).json({ success: false, message });
    }
    next(err);
  }
}
