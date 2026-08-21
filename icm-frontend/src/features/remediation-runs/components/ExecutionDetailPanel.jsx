import { useMemo } from "react";
import { Link } from "react-router-dom";
import TestExecutionDebugger from "../../workflows/components/isc/TestExecutionDebugger";
import { IN_FLIGHT, STATUS_META, WAIT_REASON_LABEL } from "../constants";
import {
  formatDate,
  formatDuration,
  formatItsmStatus,
  resolveExecutionSteps,
  resolveProgressTrace,
  stepStatusClass,
  traceStatusLabel,
} from "../utils";

export default function ExecutionDetailPanel({ executionId, detail, loading, onClose }) {
  const exec = detail?.execution;
  const executionSteps = useMemo(() => resolveExecutionSteps(detail), [detail]);
  const progressTrace = useMemo(() => resolveProgressTrace(detail), [detail]);
  const rawStatus = exec?.rawStatus || exec?.status;
  const meta = exec ? STATUS_META[rawStatus] || STATUS_META[exec.status] || STATUS_META.PENDING : null;
  const failedStepId = detail?.run?.failedStepId || exec?.currentNodeId;
  const isIamOrphan = exec?.eventType === "IAM_ORPHAN_REVIEW";
  const accountName = exec?.eventName || exec?.triggerPayload?.accountName || exec?.triggerPayload?.accountLogin;
  const applicationName =
    exec?.applicationName || exec?.triggerPayload?.applicationName || exec?.triggerPayload?.appName;

  if (!executionId) {
    return (
      <div className="isc-exec-detail-panel isc-exec-detail-empty">
        <p>Select an event to view workflow steps and audit details.</p>
      </div>
    );
  }

  if (loading || !exec) {
    return (
      <div className="isc-exec-detail-panel isc-exec-detail-empty">
        <p>Loading event details…</p>
      </div>
    );
  }

  const duration = exec.duration ?? exec.durationMs;
  const showWaitingBanner =
    IN_FLIGHT.has(rawStatus) && rawStatus !== "RUNNING" && rawStatus !== "PENDING";

  return (
    <div className="isc-exec-detail-panel">
      <div className="isc-exec-detail-header">
        <div>
          <h2 className="isc-exec-detail-title">
            {accountName || exec.workflowName || exec.entitlementName || "Remediation event"}
          </h2>
          <p className="isc-exec-detail-sub">
            {isIamOrphan
              ? `${applicationName || "Application"} · ${exec.workflowName || "IAM review"}`
              : `${exec.identityName || "—"} · ${applicationName || "Application"} · ${exec.campaignName || "Campaign"}`}
          </p>
        </div>
        <div className="isc-exec-detail-header-actions">
          {meta && <span className={`isc-exec-status-pill ${meta.className}`}>{meta.label}</span>}
          <button type="button" className="isc-btn isc-btn-outline isc-btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="isc-exec-summary-bar">
        <div>
          <span className="isc-exec-summary-label">Execution status</span>
          <strong>{meta?.label || exec.status}</strong>
        </div>
        <div>
          <span className="isc-exec-summary-label">Started</span>
          <strong>{formatDate(exec.startTime || exec.startedAt || exec.createdAt)}</strong>
        </div>
        <div>
          <span className="isc-exec-summary-label">Ended</span>
          <strong>{formatDate(exec.endTime || exec.completedAt)}</strong>
        </div>
        <div>
          <span className="isc-exec-summary-label">Duration</span>
          <strong>{formatDuration(duration)}</strong>
        </div>
      </div>

      {(rawStatus === "FAILED" || exec.status === "FAILED") && exec.failureReasonLabel && (
        <div className="isc-exec-failure-banner" role="alert">
          <span className="isc-exec-failure-banner-label">Reason</span>
          <strong>{exec.failureReasonLabel}</strong>
          {exec.failureReasonDetail && (
            <p className="isc-exec-failure-banner-detail">{exec.failureReasonDetail}</p>
          )}
        </div>
      )}

      {showWaitingBanner && (
        <div className="isc-exec-waiting-banner">
          <span className="isc-exec-waiting-banner-label">In progress</span>
          <strong>
            {isIamOrphan || exec.waitReason === "IAM_DECISION"
              ? WAIT_REASON_LABEL.IAM_DECISION
              : WAIT_REASON_LABEL[exec.waitReason] || "Awaiting removal + verification"}
          </strong>
          <p className="isc-exec-waiting-banner-detail">
            {isIamOrphan || exec.waitReason === "IAM_DECISION" ? (
              <>
                IAM has been notified. Background reminders run on schedule
                {exec.reminderPhases?.length
                  ? ` (${exec.reminderPhases.join(", ")})`
                  : " (1h, 3h, 6h, 12h)"}
                {exec.nextPollAt ? ` · next check ${formatDate(exec.nextPollAt)}` : ""}
                . The workflow resumes when IAM records a decision in the portal.
              </>
            ) : (
              <>
                Access has not been confirmed removed yet. The workflow will re-verify
                {exec.nextPollAt ? ` around ${formatDate(exec.nextPollAt)}` : " on schedule"}
                {exec.itsmTicketStatus ? `; ITSM ticket: ${formatItsmStatus(exec.itsmTicketStatus)}.` : "."}
              </>
            )}
          </p>
        </div>
      )}

      <div className="isc-exec-detail-grid isc-exec-detail-grid-debugger">
        <details className="isc-exec-detail-section isc-exec-meta-details" open={isIamOrphan}>
          <summary className="isc-exec-meta-details-summary">
            <h3>Event details</h3>
            <span className="isc-exec-meta-details-hint">
              {isIamOrphan ? "Account, workflow, IAM owner" : "Identity, entitlement, campaign"}
            </span>
          </summary>
          <div className="isc-exec-meta-details-body">
            <dl className="isc-exec-dl isc-exec-dl-compact">
              <div><dt>Event ID</dt><dd><code>{exec.executionId}</code></dd></div>
              <div><dt>Event type</dt><dd>{exec.eventType || "ACCESS_REVOKE"}</dd></div>
              <div><dt>Workflow</dt><dd>{exec.workflowName}</dd></div>
              {isIamOrphan ? (
                <>
                  <div><dt>Account</dt><dd>{accountName || "—"}</dd></div>
                  <div><dt>Application</dt><dd>{applicationName || "—"}</dd></div>
                  {exec.orphanId && (
                    <div><dt>Orphan account ID</dt><dd><code>{exec.orphanId}</code></dd></div>
                  )}
                </>
              ) : (
                <>
                  <div><dt>Entitlement</dt><dd>{exec.entitlementName || "—"}</dd></div>
                  <div><dt>Identity</dt><dd>{exec.identityName || "—"}</dd></div>
                  <div><dt>Application</dt><dd>{applicationName || "—"}</dd></div>
                  <div><dt>Campaign</dt><dd>{exec.campaignName || "—"}</dd></div>
                </>
              )}
              <div><dt>Reviewer / owner</dt><dd>{exec.eventOwner || "—"}</dd></div>
              {exec.currentNodeName && (
                <div><dt>Current step</dt><dd>{exec.currentNodeName || exec.currentStepLabel || "—"}</dd></div>
              )}
              {exec.currentStepLabel && !exec.currentNodeName && (
                <div><dt>Current step</dt><dd>{exec.currentStepLabel}</dd></div>
              )}
              {exec.ticketEventId && (
                <div>
                  <dt>Remediation ticket</dt>
                  <dd>
                    <Link to="/governance/remediation" className="isc-exec-link">
                      {formatItsmStatus(exec.itsmTicketStatus)} · {exec.ticketEventId.slice(0, 8)}…
                    </Link>
                  </dd>
                </div>
              )}
              {!exec.ticketEventId && exec.itsmTicketStatus && (
                <div><dt>ITSM ticket</dt><dd>{formatItsmStatus(exec.itsmTicketStatus)}</dd></div>
              )}
              {IN_FLIGHT.has(rawStatus) && exec.nextPollAt && (
                <div>
                  <dt>{isIamOrphan || exec.waitReason === "IAM_DECISION" ? "Next reminder check" : "Next re-verification"}</dt>
                  <dd>{formatDate(exec.nextPollAt)}</dd>
                </div>
              )}
              {isIamOrphan && exec.reminderPhases?.length > 0 && (
                <div>
                  <dt>Reminder schedule</dt>
                  <dd>
                    {exec.reminderPhases.join(", ")}
                    {exec.reminderPhaseIndex != null ? ` · ${exec.reminderPhaseIndex} sent` : ""}
                  </dd>
                </div>
              )}
              {exec.provisioningRequestId && (
                <div><dt>Provisioning request</dt><dd><code>{exec.provisioningRequestId}</code></dd></div>
              )}
              {exec.runId && (
                <div><dt>Run ID</dt><dd><code>{exec.runId}</code></dd></div>
              )}
              {(exec.errorMessage || exec.error) && (
                <div className="isc-exec-error-row">
                  <dt>Error</dt>
                  <dd>{exec.errorMessage || exec.error}</dd>
                </div>
              )}
              {exec.failureReasonCode && (
                <div className="isc-exec-error-row">
                  <dt>Failure type</dt>
                  <dd><code>{exec.failureReasonCode}</code></dd>
                </div>
              )}
            </dl>

            {(exec.stepStatuses || []).length > 0 && (
              <>
                <h3 className="isc-exec-steps-heading">Activity log</h3>
                <ul className="isc-exec-milestones">
                  {exec.stepStatuses.map((label, i) => (
                    <li key={`${label}-${i}`}>{label}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>

        {isIamOrphan ? (
          <div className="isc-exec-detail-section">
            <h3>Workflow progress</h3>
            <p className="isc-exec-no-steps" style={{ marginTop: 0, marginBottom: 12 }}>
              Canvas steps, background reminders, and IAM decision checkpoint.
            </p>
            {progressTrace.length === 0 ? (
              <p className="isc-exec-no-steps">No progress recorded yet.</p>
            ) : (
              <ol className="isc-exec-step-timeline">
                {progressTrace.map((item, idx) => (
                  <li
                    key={item.id || idx}
                    className={`isc-exec-step-item ${stepStatusClass(item.status)}`}
                  >
                    <div className="isc-exec-step-marker" aria-hidden />
                    <div className="isc-exec-step-body">
                      <div className="isc-exec-step-row">
                        <span className="isc-exec-step-name">{item.label}</span>
                        <span className={`isc-exec-step-badge ${stepStatusClass(item.status)}`}>
                          {traceStatusLabel(item.status)}
                        </span>
                      </div>
                      {item.type && item.type !== "milestone" && (
                        <span className="isc-exec-step-type">
                          {item.type}
                          {item.branch ? ` · branch ${item.branch}` : ""}
                          {item.at ? ` · ${formatDate(item.at)}` : ""}
                        </span>
                      )}
                      {item.detail && (
                        <p className="isc-exec-step-detail">{item.detail}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <div className="isc-exec-detail-section isc-exec-debugger-section">
            <h3>Node timeline</h3>
            {executionSteps.length === 0 ? (
              <p className="isc-exec-no-steps">No step trace recorded yet.</p>
            ) : (
              <TestExecutionDebugger
                executionSteps={executionSteps}
                failedStepId={failedStepId}
                variant="embedded"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
