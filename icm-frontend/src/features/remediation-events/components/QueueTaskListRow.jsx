import { Link } from "react-router-dom";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  formatRevokeAccessTaskTitle,
  formatRevokeAccessTaskContext,
  getQueueStatusMeta,
  formatQueueDate,
} from "../utils/queueTaskDisplay";
import { accessRevokeTaskPath } from "../paths";

const EVENT_TYPE_LABEL = "Access Revoke";

export default function QueueTaskListRow({ task }) {
  const meta = getQueueStatusMeta(task.status);
  const title = formatRevokeAccessTaskTitle(task);
  const context = formatRevokeAccessTaskContext(task);
  const viewPath = accessRevokeTaskPath(task.taskId);

  return (
    <div className="re-task-row">
      <div className="re-task-row__type">
        <span className="re-task-row__type-badge">{EVENT_TYPE_LABEL}</span>
      </div>

      <div className="re-task-row__main">
        <span className="re-task-row__title">{title}</span>
        <span className="re-task-row__context">{context}</span>
        <span className="re-task-row__meta">
          {task.workflowName || "Workflow"}
          <span className="re-queue-card__dot">·</span>
          {formatQueueDate(task.dateOfEntry || task.createdAt)}
        </span>
      </div>

      <div className="re-task-row__workflow" title={task.workflowName || ""}>
        {task.workflowName || "—"}
      </div>

      <div className="re-task-row__campaign" title={task.campaignName || ""}>
        {task.campaignName || "—"}
      </div>

      <div className="re-task-row__status">
        <span className={`re-queue-card__status ${meta.className}`}>{meta.label}</span>
        <span className="re-queue-card__hint">{meta.hint}</span>
      </div>

      <div className="re-task-row__action">
        <Link to={viewPath} className="re-btn re-btn--secondary re-btn--sm">
          <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
          View
        </Link>
      </div>
    </div>
  );
}
