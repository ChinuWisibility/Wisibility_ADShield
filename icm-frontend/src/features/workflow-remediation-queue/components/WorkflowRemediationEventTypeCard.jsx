import { Link } from "react-router-dom";
import { WORKFLOW_REMEDIATION_QUEUE_BASE } from "../paths";
import { DASHBOARD_STATUS_KEYS } from "../constants";

const STATUS_LABELS = {
  PENDING: "Pending",
  WITH_TICKET: "With Ticket",
  AWAITING_ITSM: "Awaiting ITSM",
  VALIDATION_PENDING: "Validation Pending",
  VALIDATED: "Validated",
};

export default function WorkflowRemediationEventTypeCard({ config, stats }) {
  const { slug, title, badge, description, accent } = config;

  return (
    <Link
      to={`${WORKFLOW_REMEDIATION_QUEUE_BASE}/${slug}`}
      className={`isc-rem-type-card isc-rem-type-card-${accent}`}
    >
      <div className="isc-rem-type-card-head">
        <h2 className="isc-rem-type-card-title">{title}</h2>
        <span className={`isc-rem-type-card-badge isc-rem-type-card-badge-${accent}`}>{badge}</span>
      </div>
      <p className="isc-rem-type-card-desc">{description}</p>
      <div className="wrq-type-card-stats">
        {DASHBOARD_STATUS_KEYS.map((key) => (
          <div key={key} className="isc-rem-type-card-stat">
            <span className="isc-rem-type-card-stat-val">{stats[key] ?? 0}</span>
            <span className="isc-rem-type-card-stat-lbl">{STATUS_LABELS[key]}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}
