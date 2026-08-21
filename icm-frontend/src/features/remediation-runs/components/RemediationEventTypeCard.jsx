import { Link } from "react-router-dom";
import { REMEDIATION_RUNS_BASE } from "../paths";

export default function RemediationEventTypeCard({ config, stats, basePath = REMEDIATION_RUNS_BASE }) {
  const { slug, title, badge, description, accent } = config;

  return (
    <Link to={`${basePath}/${slug}`} className={`isc-rem-type-card isc-rem-type-card-${accent}`}>
      <div className="isc-rem-type-card-head">
        <h2 className="isc-rem-type-card-title">{title}</h2>
        <span className={`isc-rem-type-card-badge isc-rem-type-card-badge-${accent}`}>{badge}</span>
      </div>
      <p className="isc-rem-type-card-desc">{description}</p>
      <div className="isc-rem-type-card-stats">
        <div className="isc-rem-type-card-stat">
          <span className="isc-rem-type-card-stat-val">{stats.total}</span>
          <span className="isc-rem-type-card-stat-lbl">Total</span>
        </div>
        <div className="isc-rem-type-card-stat">
          <span className="isc-rem-type-card-stat-val isc-rem-type-card-stat-active">{stats.inProgress}</span>
          <span className="isc-rem-type-card-stat-lbl">In progress</span>
        </div>
        <div className="isc-rem-type-card-stat">
          <span className="isc-rem-type-card-stat-val isc-rem-type-card-stat-ok">{stats.completed}</span>
          <span className="isc-rem-type-card-stat-lbl">Complete</span>
        </div>
        <div className="isc-rem-type-card-stat">
          <span className="isc-rem-type-card-stat-val isc-rem-type-card-stat-fail">{stats.failed}</span>
          <span className="isc-rem-type-card-stat-lbl">Failed</span>
        </div>
      </div>
    </Link>
  );
}
