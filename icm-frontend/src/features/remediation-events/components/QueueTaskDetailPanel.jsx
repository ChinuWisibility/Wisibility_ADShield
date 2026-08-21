import {
  formatRevokeAccessTaskTitle,
  formatRevokeAccessTechnicalName,
  formatIamOrphanReviewTaskTitle,
  formatIamOrphanReviewTechnicalName,
  getQueueStatusMeta,
  formatQueueDate,
} from "../utils/queueTaskDisplay";
import { isManualPickup } from "../utils/pipelinePickupUtils";
import AccessRevokePipeline from "./AccessRevokePipeline";
import EnterpriseWorkflowGuide from "./EnterpriseWorkflowGuide";

export default function QueueTaskDetailPanel({
  task,
  loading,
  refreshing = false,
  hasSelection,
  onClose,
  backLabel = "Close",
  showClose = true,
  variant = "access-revoke",
}) {
  const isIamOrphan = variant === "iam-orphan-review";

  if (!hasSelection && !task) {
    return (
      <div className="re-detail-panel re-detail-panel--empty">
        <div className="re-detail-panel__empty-icon">◎</div>
        <h3>Select a task</h3>
        <p>
          {isIamOrphan
            ? "Choose an IAM orphan review task to view account context, workflow mapping, and remediation activity."
            : "Choose an access revoke task to view certification context, workflow mapping, and remediation activity."}
        </p>
      </div>
    );
  }

  if (loading && !task) {
    return (
      <div className="re-detail-panel re-detail-panel--empty">
        <p>Loading task details…</p>
      </div>
    );
  }

  if (!task) {
    return null;
  }

  const meta = getQueueStatusMeta(task.status, variant, task);
  const manualLaunch = isManualPickup(task);
  const title = isIamOrphan
    ? formatIamOrphanReviewTaskTitle(task)
    : formatRevokeAccessTaskTitle(task);
  const technicalName = task.taskName
    || (isIamOrphan ? formatIamOrphanReviewTechnicalName(task) : formatRevokeAccessTechnicalName(task));
  const reviewerName = task.context?.reviewerName;
  const reviewerEmail = task.context?.reviewerEmail;
  const reviewedAt = task.context?.reviewedAt;

  return (
    <div className={`re-detail-panel ${refreshing ? "re-detail-panel--refreshing" : ""}`}>
      {refreshing && (
        <div className="re-detail-panel__refresh-bar" role="status" aria-live="polite">
          Updating…
        </div>
      )}
      <div className="re-detail-panel__header">
        <div className="re-detail-panel__header-main">
          <div className="re-detail-panel__title-row">
            <span className={`re-detail-panel__status ${meta.className}`}>{meta.label}</span>
            <h2 className="re-detail-panel__title">{title}</h2>
          </div>
          <p className="re-detail-panel__status-hint">{meta.hint}</p>
        </div>
        {showClose && onClose && (
          <button type="button" className="re-btn re-btn--secondary" onClick={onClose}>
            {backLabel}
          </button>
        )}
      </div>

      <div className="re-detail-panel__summary">
        <div className="re-detail-panel__summary-item">
          <span className="re-detail-panel__label">Event type</span>
          <strong>{isIamOrphan ? "IAM Orphan Review" : "Access Revoke"}</strong>
        </div>
        <div className="re-detail-panel__summary-item">
          <span className="re-detail-panel__label">Queued</span>
          <strong>{formatQueueDate(task.dateOfEntry || task.createdAt)}</strong>
        </div>
        <div className="re-detail-panel__summary-item">
          <span className="re-detail-panel__label">Workflow</span>
          <strong>{task.workflowName || "—"}</strong>
        </div>
        <div className="re-detail-panel__summary-item">
          <span className="re-detail-panel__label">{isIamOrphan ? "Application" : "Campaign"}</span>
          <strong>{isIamOrphan ? task.applicationName || "—" : task.campaignName || "—"}</strong>
        </div>
        <div className="re-detail-panel__summary-item">
          <span className="re-detail-panel__label">Created by</span>
          <strong>{task.createdBy || "—"}</strong>
        </div>
        {manualLaunch && (
          <div className="re-detail-panel__summary-item">
            <span className="re-detail-panel__label">Trigger</span>
            <strong>
              Manual launch
              {task.context?.launchedBy ? ` · ${task.context.launchedBy}` : ""}
            </strong>
          </div>
        )}
      </div>

      <div className="re-detail-panel__sections">
        <div className="re-detail-pipelines">
          <AccessRevokePipeline task={task} variant={variant} />
          <EnterpriseWorkflowGuide task={task} variant={variant} />
        </div>

        <section className="re-detail-panel__section">
          <h3>{isIamOrphan ? "Orphan account context" : "Certification context"}</h3>
          <dl className="re-detail-kv">
            <div>
              <dt>{isIamOrphan ? "Account" : "Identity"}</dt>
              <dd>{task.identityName || "—"}</dd>
            </div>
            {task.identityEmail && (
              <div>
                <dt>Email</dt>
                <dd>{task.identityEmail}</dd>
              </div>
            )}
            {task.applicationName && (
              <div>
                <dt>Application</dt>
                <dd>{task.applicationName}</dd>
              </div>
            )}
            {isIamOrphan && task.context?.riskLevel && (
              <div>
                <dt>Risk level</dt>
                <dd>{task.context.riskLevel}</dd>
              </div>
            )}
            {!isIamOrphan && task.entitlementName && (
              <div>
                <dt>Entitlement</dt>
                <dd>{task.entitlementName}</dd>
              </div>
            )}
            {(reviewerName || reviewerEmail) && (
              <div>
                <dt>Reviewer</dt>
                <dd>
                  {reviewerName || reviewerEmail}
                  {reviewerName && reviewerEmail ? ` (${reviewerEmail})` : ""}
                </dd>
              </div>
            )}
            {reviewedAt && (
              <div>
                <dt>Reviewed at</dt>
                <dd>{formatQueueDate(reviewedAt)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="re-detail-panel__section">
          <h3>Queue record</h3>
          <dl className="re-detail-kv">
            <div>
              <dt>Task name</dt>
              <dd>
                <code className="re-detail-code">{technicalName}</code>
              </dd>
            </div>
            <div>
              <dt>Task ID</dt>
              <dd>
                <code className="re-detail-code">{task.taskId}</code>
              </dd>
            </div>
            <div>
              <dt>Remediation status</dt>
              <dd>{meta.label}</dd>
            </div>
            {task.failureReason && (
              <div>
                <dt>Failure reason</dt>
                <dd className="re-detail-kv__error">{task.failureReason}</dd>
              </div>
            )}
          </dl>
        </section>

        {Array.isArray(task.stepLog) && task.stepLog.length > 0 && (
          <section className="re-detail-panel__section re-detail-panel__section--full">
            <h3>Activity</h3>
            <ol className="re-detail-activity">
              {task.stepLog.map((step, idx) => (
                <li key={idx}>
                  <span className="re-detail-activity__time">{formatQueueDate(step.at)}</span>
                  <span className="re-detail-activity__label">{step.label}</span>
                  {step.status && (
                    <span className="re-detail-activity__status">{step.status}</span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
