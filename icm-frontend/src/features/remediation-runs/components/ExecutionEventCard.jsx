import { IN_FLIGHT, STATUS_META } from "../constants";
import { formatDate, latestProgressLabel } from "../utils";

function eventTypeBadgeLabel(eventType) {
  const map = {
    ACCESS_REVOKE: "ACCESS REVOKE",
    REVOKE_ACCESS: "ACCESS REVOKE",
    MISSING_MANAGER: "MISSING MANAGER",
    ORPHAN_ACCOUNT: "ORPHAN ACCOUNTS",
    ORPHAN_ACCOUNTS: "ORPHAN ACCOUNTS",
    DORMANT_ACCOUNT: "DORMANT ACCOUNTS",
    INACTIVE_USER_ACCESS: "DORMANT ACCOUNTS",
    SOD_VIOLATION: "SOD VIOLATIONS",
    SOD_VIOLATIONS: "SOD VIOLATIONS",
    IAM_ORPHAN_REVIEW: "IAM ORPHAN REVIEW",
  };
  const key = String(eventType || "ACCESS_REVOKE").toUpperCase();
  return map[key] || key.replace(/_/g, " ");
}

export default function ExecutionEventCard({ exec, selected, onSelect, eventTypeAccent }) {
  const statusKey = exec.status;
  const meta = STATUS_META[statusKey] || STATUS_META.PENDING;
  const inFlight = IN_FLIGHT.has(statusKey);
  const accent = eventTypeAccent || "green";
  const isIamOrphan = exec?.eventType === "IAM_ORPHAN_REVIEW";
  const accountName = exec?.eventName || exec?.triggerPayload?.accountName;
  const applicationName = exec?.applicationName || exec?.triggerPayload?.applicationName;

  return (
    <button
      type="button"
      className={`isc-exec-event-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(exec)}
    >
      <div className="isc-exec-event-card-top">
        <div className="isc-exec-event-identity">
          <span className="isc-exec-event-title">
            {isIamOrphan ? accountName || exec.workflowName || "IAM review" : exec.eventName || exec.entitlementName || "Access revoke"}
          </span>
          <span className="isc-exec-event-sub">
            {isIamOrphan
              ? `${applicationName || "Application"} · ${exec.workflowName || "IAM review"}`
              : exec.identityName || "—"}
          </span>
        </div>
        <span className={`isc-exec-status-pill ${meta.className}`}>{meta.label}</span>
      </div>
      <div className="isc-exec-event-tags">
        <span className={`isc-rem-type-tag isc-rem-type-tag-${accent}`}>
          {eventTypeBadgeLabel(exec.eventType)}
        </span>
        {exec.applicationName && (
          <span className="isc-rem-app-tag">{exec.applicationName.toUpperCase()}</span>
        )}
      </div>
      <div className="isc-exec-event-meta">
        <span>{exec.workflowName || "Workflow"}</span>
        <span className="isc-exec-dot">·</span>
        <span>{formatDate(exec.startedAt || exec.createdAt)}</span>
      </div>
      <div className="isc-exec-event-progress">
        {inFlight && <span className="isc-exec-live-dot" aria-hidden />}
        <span>
          {exec.status === "FAILED" && exec.failureReasonLabel
            ? exec.failureReasonLabel
            : latestProgressLabel(exec)}
        </span>
      </div>
      <div className="isc-exec-event-footer">
        <code className="isc-exec-id">{exec.executionId?.slice(0, 8)}</code>
        <span>{exec.eventOwner || "system"}</span>
      </div>
    </button>
  );
}
