import { Link } from "react-router-dom";
import { QUEUE_STATUS_META, formatQueueDate } from "../constants";
import { remediationRunsPath } from "../../remediation-runs/paths";

export default function WorkflowRemediationDetailPanel({
  event,
  items,
  loading,
  config,
  onCreateTicket,
  onTriggerWorkflow,
  actionLoading,
}) {
  if (loading) {
    return (
      <aside className="wrq-detail-panel wrq-detail-empty">
        <p>Loading event details…</p>
      </aside>
    );
  }

  if (!event) {
    return (
      <aside className="wrq-detail-panel wrq-detail-empty">
        <p>Select an event to view details, subjects, and audit history.</p>
      </aside>
    );
  }

  const statusMeta = QUEUE_STATUS_META[event.queueStatus] || QUEUE_STATUS_META.PENDING;
  const canTicket = ["PENDING", "WITH_TICKET"].includes(event.queueStatus);
  const canTrigger = ["PENDING", "WITH_TICKET", "VALIDATED"].includes(event.queueStatus);
  const executionIds = event.metadata?.executionIds || [];
  const subjectCount = items?.length || event.subjectCount || 0;

  return (
    <aside className="wrq-detail-panel">
      <div className="wrq-detail-header">
        <div>
          <h2 className="wrq-detail-title">{event.eventId}</h2>
          <p className="wrq-detail-sub">
            {event.eventType?.replace(/_/g, " ")} · {formatQueueDate(event.createdAt)}
          </p>
        </div>
        <span className={`isc-exec-status-pill ${statusMeta.className}`}>{statusMeta.label}</span>
      </div>

      <div className="wrq-detail-summary">
        {event.campaignName && (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Campaign</span>
            <span className="wrq-detail-summary-value">{event.campaignName}</span>
          </div>
        )}
        {event.applicationName && (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Application</span>
            <span className="wrq-detail-summary-value">{event.applicationName}</span>
          </div>
        )}
        <div className="wrq-detail-summary-item">
          <span className="wrq-detail-summary-label">Items</span>
          <span className="wrq-detail-summary-value">{subjectCount}</span>
        </div>
        {event.selectedWorkflowName || event.workflowName ? (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Workflow</span>
            <span className="wrq-detail-summary-value">
              {event.selectedWorkflowName || event.workflowName}
            </span>
          </div>
        ) : null}
        <div className="wrq-detail-summary-item">
          <span className="wrq-detail-summary-label">Status</span>
          <span className="wrq-detail-summary-value">{statusMeta.label}</span>
        </div>
        {(event.queuedBy || event.createdBy) && (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Created By</span>
            <span className="wrq-detail-summary-value">{event.queuedBy || event.createdBy}</span>
          </div>
        )}
        {(event.queuedAt || event.createdAt) && (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Created At</span>
            <span className="wrq-detail-summary-value">
              {formatQueueDate(event.queuedAt || event.createdAt)}
            </span>
          </div>
        )}
        {event.ticketNumber && (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Ticket</span>
            <span className="wrq-detail-summary-value">{event.ticketNumber}</span>
          </div>
        )}
        {event.workflowName && !event.selectedWorkflowName && (
          <div className="wrq-detail-summary-item">
            <span className="wrq-detail-summary-label">Triggered Workflow</span>
            <span className="wrq-detail-summary-value">{event.workflowName}</span>
          </div>
        )}
      </div>

      <div className="wrq-detail-actions">
        {canTicket && (
          <button type="button" className="isc-btn isc-btn-outline" disabled={actionLoading} onClick={onCreateTicket}>
            Create Ticket
          </button>
        )}
        {canTrigger && (
          <button type="button" className="isc-btn isc-btn-primary" disabled={actionLoading} onClick={onTriggerWorkflow}>
            Trigger Workflow
          </button>
        )}
      </div>

      {executionIds.length > 0 && config?.runsSlug && (
        <div className="wrq-detail-section">
          <h3 className="wrq-detail-section-title">Workflow Executions</h3>
          {executionIds.map((id) => (
            <Link
              key={id}
              to={remediationRunsPath(config.runsSlug, { executionId: id })}
              className="isc-link-btn"
              style={{ display: "block", marginBottom: 6, fontSize: "0.84rem" }}
            >
              View execution {id.slice(0, 8)}…
            </Link>
          ))}
        </div>
      )}

      <div className="wrq-detail-section">
        <h3 className="wrq-detail-section-title">Subjects ({subjectCount})</h3>
        <div className="wrq-detail-table-wrap">
          <table className="wrq-detail-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Application</th>
                <th>Entitlement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "#94a3b8" }}>
                    No subjects loaded
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item._id}>
                    <td>{item.identityName || item.accountId || item.userId || "—"}</td>
                    <td>{item.applicationName || "—"}</td>
                    <td>{item.entitlementName || "—"}</td>
                    <td>{item.status || "PENDING"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(event.auditHistory || []).length > 0 && (
        <div className="wrq-detail-section">
          <h3 className="wrq-detail-section-title">Audit History</h3>
          <ul className="wrq-audit-list">
            {[...(event.auditHistory || [])].reverse().map((entry, i) => (
              <li key={i}>
                <strong>{entry.action}</strong>
                <span> — {entry.actor}</span>
                <span className="wrq-audit-time"> · {formatQueueDate(entry.performedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
