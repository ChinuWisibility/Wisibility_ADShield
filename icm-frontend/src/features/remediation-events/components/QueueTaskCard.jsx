import {
  formatRevokeAccessTaskTitle,
  formatRevokeAccessTaskContext,
  getQueueStatusMeta,
  formatQueueDate,
} from "../utils/queueTaskDisplay";

export default function QueueTaskCard({ task, selected, onSelect }) {
  const meta = getQueueStatusMeta(task.status);
  const title = formatRevokeAccessTaskTitle(task);
  const context = formatRevokeAccessTaskContext(task);

  return (
    <button
      type="button"
      className={`re-queue-card ${selected ? "is-selected" : ""}`}
      onClick={() => onSelect(task)}
    >
      <div className="re-queue-card__row">
        <div className="re-queue-card__main">
          <span className="re-queue-card__title" title={title}>
            {title}
          </span>
          <span className="re-queue-card__context" title={context}>
            {context}
          </span>
          <span className="re-queue-card__meta">
            {task.workflowName || "Workflow"}
            <span className="re-queue-card__dot">·</span>
            {formatQueueDate(task.dateOfEntry || task.createdAt)}
          </span>
        </div>
        <div className="re-queue-card__aside">
          <span className={`re-queue-card__status ${meta.className}`}>{meta.label}</span>
          <span className="re-queue-card__hint">{meta.hint}</span>
        </div>
      </div>
    </button>
  );
}

export { getQueueStatusMeta as QUEUE_STATUS_META, formatQueueDate };
