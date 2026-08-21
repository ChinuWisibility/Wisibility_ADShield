import { QUEUE_STATUS_META, formatQueueDate } from "../constants";

function titleForEvent(event) {
  if (event.campaignName) return event.campaignName;
  if (event.applicationName) return event.applicationName;
  return event.eventType?.replace(/_/g, " ") || "Remediation event";
}

function subtitleForEvent(event) {
  const parts = [];
  if (event.applicationName && event.campaignName) parts.push(event.applicationName);
  parts.push(`${event.subjectCount ?? 0} subject(s)`);
  if (event.selectedWorkflowName) parts.push(event.selectedWorkflowName);
  return parts.join(" · ");
}

export default function WorkflowRemediationQueueEventCard({ event, selected, onSelect, config }) {
  const statusMeta = QUEUE_STATUS_META[event.queueStatus] || QUEUE_STATUS_META.PENDING;
  const accent = config?.accent || "green";

  return (
    <button
      type="button"
      className={`wrq-event-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(event)}
    >
      <div className="wrq-event-card-top">
        <div>
          <span className="wrq-event-card-title">{titleForEvent(event)}</span>
          <span className="wrq-event-card-sub">{subtitleForEvent(event)}</span>
        </div>
        <span className={`isc-exec-status-pill ${statusMeta.className}`}>{statusMeta.label}</span>
      </div>

      <div className="isc-exec-event-tags">
        <span className={`isc-rem-type-tag isc-rem-type-tag-${accent}`}>
          {config?.badge || event.eventType?.replace(/_/g, " ")}
        </span>
        {event.applicationName && (
          <span className="isc-rem-app-tag">{event.applicationName}</span>
        )}
      </div>

      <div className="wrq-event-card-fields">
        {event.campaignName && (
          <div className="wrq-event-card-row">
            <span className="wrq-event-card-lbl">Campaign</span>
            <span className="wrq-event-card-val">{event.campaignName}</span>
          </div>
        )}
        <div className="wrq-event-card-row">
          <span className="wrq-event-card-lbl">Workflow</span>
          <span className="wrq-event-card-val">
            {event.selectedWorkflowName || event.workflowName || "—"}
          </span>
        </div>
        <div className="wrq-event-card-row">
          <span className="wrq-event-card-lbl">Status</span>
          <span className="wrq-event-card-val">{statusMeta.label}</span>
        </div>
        <div className="wrq-event-card-row">
          <span className="wrq-event-card-lbl">Queued</span>
          <span className="wrq-event-card-val">{formatQueueDate(event.queuedAt || event.createdAt)}</span>
        </div>
      </div>

      <div className="wrq-event-card-footer">
        <code className="isc-exec-id">{event.eventId}</code>
        <span>{event.createdBy || "system"}</span>
      </div>
    </button>
  );
}
