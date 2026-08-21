import { Link } from "react-router-dom";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  formatIamOrphanReviewTaskTitle,
  formatIamOrphanReviewTaskContext,
  getQueueStatusMeta,
  formatQueueDate,
} from "../utils/queueTaskDisplay";
import { iamOrphanReviewTaskPath } from "../paths";

export default function IamOrphanTaskListRow({ task }) {
  const meta = getQueueStatusMeta(task.status, "iam-orphan-review", task);
  const title = formatIamOrphanReviewTaskTitle(task);
  const context = formatIamOrphanReviewTaskContext(task);
  const viewPath = iamOrphanReviewTaskPath(task.taskId);

  return (
    <div className="re-task-row">
      <div className="re-task-row__type">
        <span className="re-task-row__type-badge re-task-row__type-badge--amber">IAM Orphan</span>
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

      <div className="re-task-row__campaign" title={task.applicationName || ""}>
        {task.applicationName || "—"}
      </div>

      <div className="re-task-row__status">
        <span className={`re-queue-card__status ${meta.className}`}>{meta.label}</span>
        <span className="re-queue-card__hint">{meta.hint}</span>
      </div>

      <div className="re-task-row__action">
        <Link
          to={viewPath}
          className="re-btn re-btn--secondary re-btn--sm"
        >
          <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
          View
        </Link>
      </div>
    </div>
  );
}
