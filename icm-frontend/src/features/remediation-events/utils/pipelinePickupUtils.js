/** Detect whether a queue task was launched manually (not by the remediation scheduler). */

export function isManualPickup(task) {
  if (!task) return false;
  if (task.context?.triggerMode === "manual") return true;
  return (task.stepLog || []).some((s) =>
    String(s?.label || "").toLowerCase().includes("manual trigger picked"),
  );
}

export function findPickupStepAt(task) {
  const log = task?.stepLog || [];
  for (const entry of log) {
    const label = String(entry?.label || "").toLowerCase();
    if (
      label.includes("manual trigger picked") ||
      label.includes("scheduler picked")
    ) {
      return entry?.at || null;
    }
  }
  return null;
}

export function getPickupStageCopy(task) {
  if (isManualPickup(task)) {
    return {
      label: "Manual launch",
      shortLabel: "Manual",
      description:
        "Launched immediately by a user — workflow started without waiting for the remediation scheduler.",
      timestampLabel: "Launched",
      pickupHint: task?.context?.launchedBy
        ? `Manual launch · ${task.context.launchedBy}`
        : "Manual launch — not scheduler",
    };
  }
  return {
    label: "Scheduler pickup",
    shortLabel: "Scheduler",
    description:
      "Remediation scheduler picked up the task and marked it in progress.",
    timestampLabel: "Picked up",
    pickupHint: null,
  };
}
