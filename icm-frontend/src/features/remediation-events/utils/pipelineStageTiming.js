import { formatQueueDate } from "./queueTaskDisplay";
import { findPickupStepAt, getPickupStageCopy, isManualPickup } from "./pipelinePickupUtils";

function findStepAt(task, fragments = []) {
  const log = task?.stepLog || [];
  for (const fragment of fragments) {
    const needle = String(fragment || "").toLowerCase();
    const hit = log.find((s) => String(s?.label || "").toLowerCase().includes(needle));
    if (hit?.at) return hit.at;
  }
  return null;
}

function formatAt(value) {
  if (!value) return null;
  return formatQueueDate(value);
}

function scheduleIntervalLabel(scheduler) {
  if (!scheduler?.scheduleType) return null;
  const n = Math.max(Number(scheduler.interval) || 1, 1);
  const unit =
    scheduler.scheduleType === "HOUR"
      ? "hour"
      : scheduler.scheduleType === "DAY"
        ? "day"
        : "min";
  return `Every ${n} ${unit}${n === 1 ? "" : "s"}`;
}

function baseStageTiming(stageId, task, state) {
  const scheduler = task?.schedulerContext;
  const manual = isManualPickup(task);
  const pickupCopy = getPickupStageCopy(task);

  switch (stageId) {
    case "decision":
      return {
        timestamp:
          findStepAt(task, ["orphan flagged", "revoke decision recorded"]) ||
          task?.context?.reviewedAt,
        timestampLabel: "Started",
      };
    case "enqueue":
      return {
        timestamp: task?.dateOfEntry || findStepAt(task, ["queue created"]),
        timestampLabel: "Queued",
        hint:
          task?.status === "NEW" && scheduler?.pendingPickup
            ? "Scheduler ran after queue but did not pick up — use Launch immediately"
            : state === "active" && task?.status === "NEW" && !manual && scheduler?.nextRunAt
              ? `Next scheduler · ${formatAt(scheduler.nextRunAt)}`
              : state !== "upcoming" && !manual && scheduler?.enabled
                ? scheduleIntervalLabel(scheduler)
                : manual && state === "done"
                  ? "Queued before manual launch"
                  : null,
      };
    case "scheduler": {
      const pickedAt = findPickupStepAt(task);
      return {
        timestamp: pickedAt,
        timestampLabel: pickedAt ? pickupCopy.timestampLabel : manual ? "Manual" : "Awaiting",
        hint:
          pickedAt && manual
            ? pickupCopy.pickupHint
            : !pickedAt && state === "active" && !manual && scheduler?.nextRunAt
              ? `Next run · ${formatAt(scheduler.nextRunAt)}`
              : pickedAt
                ? null
                : !manual && state === "active" && scheduler?.lastRunAt
                  ? `Last run · ${formatAt(scheduler.lastRunAt)}`
                  : !manual
                    ? scheduleIntervalLabel(scheduler)
                    : null,
      };
    }
    case "workflow":
      return {
        timestamp: task?.executionStartedAt || findStepAt(task, ["workflow started"]),
        timestampLabel: "Started",
        hint:
          state === "active" && task?.status === "WAITING"
            ? "Paused — awaiting external step"
            : manual && state === "active"
              ? "Started via manual launch"
              : null,
      };
    case "complete":
      return {
        timestamp: task?.completedAt || findStepAt(task, ["queue completed"]),
        timestampLabel: "Finished",
      };
    default:
      return {};
  }
}

export function attachPipelineStageTiming(stages, task) {
  const pickupCopy = getPickupStageCopy(task);

  return stages.map((stage) => {
    const stageDef =
      stage.id === "scheduler" && isManualPickup(task)
        ? {
            ...stage,
            label: pickupCopy.label,
            shortLabel: pickupCopy.shortLabel,
            description: pickupCopy.description,
          }
        : stage;

    const timing = baseStageTiming(stageDef.id, task, stageDef.state);
    const formatted = timing.timestamp ? formatAt(timing.timestamp) : null;

    return {
      ...stageDef,
      ...timing,
      formattedTime: formatted,
      timeDisplay: formatted
        ? `${timing.timestampLabel} · ${formatted}`
        : timing.hint || null,
    };
  });
}
