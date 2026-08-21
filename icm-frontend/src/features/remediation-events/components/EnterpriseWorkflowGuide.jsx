import { Link } from "react-router-dom";
import {
  ENTERPRISE_ACCESS_REVOKE_MODEL,
  buildAccessRevokeWorkflowStages,
} from "../utils/enterpriseAccessRevokeGuide";
import {
  ENTERPRISE_IAM_ORPHAN_MODEL,
  buildEnterpriseIamOrphanStages,
} from "../utils/enterpriseIamOrphanGuide";

const GUIDE_COPY = {
  "access-revoke": {
    model: ENTERPRISE_ACCESS_REVOKE_MODEL,
    buildStages: buildAccessRevokeWorkflowStages,
  },
  "iam-orphan-review": {
    model: ENTERPRISE_IAM_ORPHAN_MODEL,
    buildStages: buildEnterpriseIamOrphanStages,
  },
};

export default function EnterpriseWorkflowGuide({ task, variant = "access-revoke" }) {
  const copy = GUIDE_COPY[variant] || GUIDE_COPY["access-revoke"];
  const stages = copy.buildStages(task);
  const activeIndex = stages.findIndex((s) => s.state === "active" || s.state === "failed");
  const activeStage = activeIndex >= 0 ? stages[activeIndex] : null;
  const doneCount = stages.filter((s) => s.state === "done").length;
  const workflowCtx = task?.workflowContext;

  return (
    <section className="re-pipeline-panel re-pipeline-panel--workflow re-enterprise-guide re-pipeline-panel--animated">
      <div className="re-pipeline-panel__head">
        <div className="re-pipeline-panel__head-main">
          <h3>Workflow pipeline</h3>
          <p className="re-pipeline-panel__workflow-name" title={task?.workflowName || copy.model.name}>
            {task?.workflowName || copy.model.name}
          </p>
        </div>
        <div className="re-pipeline-panel__head-actions">
          <span className="re-pipeline-panel__progress">
            {doneCount}/{stages.length} steps
          </span>
          {workflowCtx?.executionStartedAt && (
            <span className="re-pipeline-panel__scheduler-chip re-pipeline-panel__scheduler-chip--blue">
              Started{" "}
              {new Date(workflowCtx.executionStartedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {task?.workflowId ? (
            <Link
              to={`/governance/workflows/${task.workflowId}/edit`}
              className="re-enterprise-guide__tag re-enterprise-guide__tag--link"
            >
              Canvas
            </Link>
          ) : (
            <span className="re-enterprise-guide__tag">Canvas</span>
          )}
        </div>
      </div>

      <ol className="re-enterprise-timeline" aria-label="Workflow steps">
        {stages.map((stage, index) => {
          const isActive = stage.state === "active" || stage.state === "failed";
          const showDescription = stage.state === "done" || isActive;

          return (
            <li
              key={stage.id}
              className={`re-enterprise-timeline__step re-enterprise-timeline__step--${stage.state}`}
              style={{ "--re-step-i": index }}
            >
              <div className="re-enterprise-timeline__rail" aria-hidden>
                <span className="re-enterprise-timeline__marker">
                  {stage.state === "done" ? "✓" : index + 1}
                </span>
                {index < stages.length - 1 && (
                  <span
                    className={`re-enterprise-timeline__spine ${
                      stage.state === "done" ? "re-enterprise-timeline__spine--done" : ""
                    }`}
                  />
                )}
              </div>

              <article className="re-enterprise-timeline__card">
                <header className="re-enterprise-timeline__card-head">
                  <span className="re-enterprise-timeline__phase">
                    {stage.shortLabel || `Step ${index + 1}`}
                  </span>
                  {isActive && (
                    <span className="re-enterprise-timeline__status-pill re-enterprise-timeline__status-pill--live">
                      {stage.state === "failed" ? "Failed" : "In progress"}
                    </span>
                  )}
                  {stage.state === "done" && (
                    <span className="re-enterprise-timeline__status-pill re-enterprise-timeline__status-pill--done">
                      Complete
                    </span>
                  )}
                </header>
                <h4 className="re-enterprise-timeline__title">{stage.label}</h4>
                {(stage.formattedTime || stage.hint) && (
                  <p className="re-enterprise-timeline__time">
                    {stage.formattedTime ? (
                      <time dateTime={stage.timestamp}>{stage.timeDisplay}</time>
                    ) : (
                      stage.hint
                    )}
                  </p>
                )}
                {showDescription && stage.description && (
                  <p
                    className={`re-enterprise-timeline__desc ${
                      stage.state === "done" ? "re-enterprise-timeline__desc--muted" : ""
                    }`}
                  >
                    {stage.description}
                  </p>
                )}
              </article>
            </li>
          );
        })}
      </ol>

      {!activeStage && task?.status === "NEW" && variant === "access-revoke" && (
        <div className="re-pipeline-panel__caption re-pipeline-panel__caption--workflow">
          <span className="re-pipeline-panel__caption-kicker">Waiting for scheduler</span>
          <p>
            Sign-off is complete. The mapped workflow has not started yet — the remediation scheduler
            will pick up this queue task and run the canvas steps above.
          </p>
        </div>
      )}

      {activeStage && (
        <div className="re-pipeline-panel__caption re-pipeline-panel__caption--workflow re-pipeline-panel__caption--enter">
          <span className="re-pipeline-panel__caption-kicker">
            Step {activeIndex + 1} · {activeStage.shortLabel || activeStage.label}
          </span>
          <p>{activeStage.description}</p>
          {workflowCtx?.actionEmail && (
            <p style={{ marginTop: 8 }}>
              Action email: <strong>{workflowCtx.actionEmail.status}</strong>
              {workflowCtx.actionEmail.to ? ` → ${workflowCtx.actionEmail.to}` : ""}
              {workflowCtx.actionEmail.lastError
                ? ` · ${String(workflowCtx.actionEmail.lastError).split("\n")[0]}`
                : ""}
            </p>
          )}
          <dl className="re-pipeline-timing-detail">
            {activeStage.formattedTime && (
              <div>
                <dt>{activeStage.timestampLabel}</dt>
                <dd>{activeStage.formattedTime}</dd>
              </div>
            )}
            {activeStage.hint && (
              <div>
                <dt>Detail</dt>
                <dd>{activeStage.hint}</dd>
              </div>
            )}
            {workflowCtx?.nextPollAt && activeStage.id === "wait" && (
              <div>
                <dt>Next scheduler check</dt>
                <dd>
                  {new Date(workflowCtx.nextPollAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}
