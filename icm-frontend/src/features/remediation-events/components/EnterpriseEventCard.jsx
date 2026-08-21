import { Link } from "react-router-dom";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import GppBadOutlinedIcon from "@mui/icons-material/GppBadOutlined";
import { REMEDIATION_EVENTS_BASE } from "../paths";

const ICONS = {
  "iam-orphan-review": PersonOffOutlinedIcon,
  "access-revoke": GppBadOutlinedIcon,
};

export default function EnterpriseEventCard({ config, stats, basePath = REMEDIATION_EVENTS_BASE }) {
  const Icon = ICONS[config.slug] || GppBadOutlinedIcon;
  const { slug, title, badge, category, description, accent } = config;
  const total = stats?.total ?? 0;
  const inProgress = stats?.inProgress ?? 0;
  const completed = stats?.completed ?? 0;
  const failed = stats?.failed ?? 0;
  const donePct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const needsAttention = inProgress > 0 || failed > 0;

  return (
    <Link
      to={`${basePath}/${slug}`}
      className={`re-event-card re-event-card--${accent}${needsAttention ? " is-attention" : ""}`}
    >
      <div className="re-event-card__header">
        <div className={`re-event-card__icon re-event-card__icon--${accent}`}>
          <Icon fontSize="small" />
        </div>
        <div className="re-event-card__tags">
          <span className={`re-event-card__badge re-event-card__badge--${accent}`}>{badge}</span>
          {needsAttention && (
            <span className={`re-event-card__pulse ${failed > 0 ? "is-fail" : ""}`}>
              {failed > 0 ? `${failed} failed` : `${inProgress} active`}
            </span>
          )}
        </div>
      </div>

      <div className="re-event-card__content">
        <h2 className="re-event-card__title">{title}</h2>
        {category && <p className="re-event-card__category">{category}</p>}
        <p className="re-event-card__desc">{description}</p>
      </div>

      <div className="re-event-card__progress" aria-hidden={total === 0}>
        <div className="re-event-card__progress-meta">
          <span>Completion</span>
          <strong>{total ? `${donePct}%` : "—"}</strong>
        </div>
        <div className="re-event-card__progress-track">
          <div
            className={`re-event-card__progress-fill re-event-card__progress-fill--${accent}`}
            style={{ width: `${donePct}%` }}
          />
        </div>
      </div>

      <div className="re-event-card__metrics">
        <div className="re-event-card__metric">
          <span className="re-event-card__metric-val">{total}</span>
          <span className="re-event-card__metric-lbl">Total</span>
        </div>
        <div className="re-event-card__metric re-event-card__metric--active">
          <span className="re-event-card__metric-val">{inProgress}</span>
          <span className="re-event-card__metric-lbl">In progress</span>
        </div>
        <div className="re-event-card__metric re-event-card__metric--ok">
          <span className="re-event-card__metric-val">{completed}</span>
          <span className="re-event-card__metric-lbl">Complete</span>
        </div>
        <div className="re-event-card__metric re-event-card__metric--fail">
          <span className="re-event-card__metric-val">{failed}</span>
          <span className="re-event-card__metric-lbl">Failed</span>
        </div>
      </div>

      <div className="re-event-card__footer">
        <span>Open queue</span>
        <ArrowForwardRoundedIcon sx={{ fontSize: 18 }} />
      </div>
    </Link>
  );
}
