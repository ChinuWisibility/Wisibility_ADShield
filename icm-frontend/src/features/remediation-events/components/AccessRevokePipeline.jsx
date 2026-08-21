import { buildAccessRevokePipelineStages } from "../utils/accessRevokePipeline";
import { buildIamOrphanReviewPipelineStages } from "../utils/iamOrphanReviewPipeline";
import { isManualPickup } from "../utils/pipelinePickupUtils";

const PIPELINE_COPY = {
  "access-revoke": {
    title: "Remediation pipeline",
    subtitle: "Queue → scheduler → workflow → completion",
    buildStages: buildAccessRevokePipelineStages,
  },
  "iam-orphan-review": {
    title: "Remediation pipeline",
    subtitle: "Decision → queue → scheduler → IAM workflow",
    buildStages: buildIamOrphanReviewPipelineStages,
  },
};

function pipelineSubtitle(variant, task) {
  if (isManualPickup(task)) {
    return variant === "iam-orphan-review"
      ? "Decision → queue → manual launch → IAM workflow"
      : "Queue → manual launch → workflow → completion";
  }
  const copy = PIPELINE_COPY[variant] || PIPELINE_COPY["access-revoke"];
  return copy.subtitle;
}

function captionHintLabel(stage) {
  if (stage?.id === "workflow") return "Workflow";
  if (stage?.id === "scheduler") return stage.shortLabel === "Manual" ? "Launch" : "Scheduler";
  if (stage?.id === "enqueue") return "Queue";
  return "Details";
}

export default function AccessRevokePipeline({ task, variant = "access-revoke" }) {
  const copy = PIPELINE_COPY[variant] || PIPELINE_COPY["access-revoke"];
  const stages = copy.buildStages(task);
  const activeIndex = stages.findIndex((s) => s.state === "active" || s.state === "failed");
  const activeStage = activeIndex >= 0 ? stages[activeIndex] : null;
  const doneCount = stages.filter((s) => s.state === "done").length;
  const scheduler = task?.schedulerContext;
  const manualLaunch = isManualPickup(task);

  return (
    <section className="re-pipeline-panel re-pipeline-panel--remediation re-pipeline-panel--horizontal re-pipeline-panel--animated">
      <div className="re-pipeline-panel__head">
        <div>
          <h3>{copy.title}</h3>
          <p className="re-pipeline-panel__subtitle">{pipelineSubtitle(variant, task)}</p>
        </div>
        <div className="re-pipeline-panel__head-meta">
          <span className="re-pipeline-panel__progress">
            {doneCount}/{stages.length} complete
          </span>
          {manualLaunch && task?.status !== "NEW" && (
            <span className="re-pipeline-panel__scheduler-chip re-pipeline-panel__scheduler-chip--manual">
              Manual launch
            </span>
          )}
          {!manualLaunch && scheduler?.enabled && scheduler?.nextRunAt && task?.status === "NEW" && (
            <span
              className={`re-pipeline-panel__scheduler-chip ${
                scheduler.pendingPickup ? "re-pipeline-panel__scheduler-chip--warn" : ""
              }`}
              title={
                scheduler.pendingPickup
                  ? "Scheduler ran after this task was queued but did not pick it up"
                  : "Remediation queue scheduler"
              }
            >
              Scheduler · {new Date(scheduler.nextRunAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      <div className="re-workflow-track re-workflow-track--remediation">
        <ol className="re-pipeline re-pipeline--horizontal re-pipeline--remediation" aria-label="Remediation stages">
          {stages.map((stage, index) => (
            <li
              key={stage.id}
              className={`re-pipeline__step re-pipeline__step--${stage.state} re-pipeline__step--h`}
              style={{ "--re-step-i": index }}
            >
              <div
                className={`re-pipeline__h-node ${
                  stage.state === "active" || stage.state === "failed" ? "re-pipeline__h-node--focus" : ""
                }`}
              >
                <span className="re-pipeline__marker" aria-hidden>
                  {stage.state === "done" ? "✓" : index + 1}
                </span>
                <span className="re-pipeline__label">{stage.shortLabel || stage.label}</span>
                {(stage.state === "active" || stage.state === "failed" || stage.state === "done") && (
                  <span className="re-pipeline__h-title">{stage.label}</span>
                )}
                {stage.formattedTime && (
                  <time className="re-pipeline__h-time" dateTime={stage.timestamp}>
                    {stage.timeDisplay}
                  </time>
                )}
                {!stage.formattedTime && stage.hint && stage.state !== "upcoming" && (
                  <span className="re-pipeline__h-time re-pipeline__h-time--hint">{stage.hint}</span>
                )}
              </div>
              {index < stages.length - 1 && (
                <span
                  className={`re-pipeline__h-connector ${
                    stage.state === "done" ? "re-pipeline__h-connector--done" : ""
                  }`}
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      {activeStage && (
        <div className="re-pipeline-panel__caption re-pipeline-panel__caption--active re-pipeline-panel__caption--enter">
          <span className="re-pipeline-panel__caption-kicker">
            Step {activeIndex + 1} · {activeStage.shortLabel || activeStage.label}
          </span>
          <p>{activeStage.description}</p>
          <dl className="re-pipeline-timing-detail">
            {activeStage.formattedTime && (
              <div>
                <dt>{activeStage.timestampLabel}</dt>
                <dd>{activeStage.formattedTime}</dd>
              </div>
            )}
            {activeStage.hint && (
              <div>
                <dt>{captionHintLabel(activeStage)}</dt>
                <dd>{activeStage.hint}</dd>
              </div>
            )}
            {!manualLaunch && scheduler?.lastRunAt && activeStage.id === "enqueue" && task?.status === "NEW" && (
              <div>
                <dt>Last scheduler run</dt>
                <dd>
                  {new Date(scheduler.lastRunAt).toLocaleString(undefined, {
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
