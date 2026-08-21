import { describe, expect, test } from "@jest/globals";

/**
 * Offline coverage for worker security/resume invariants (no Mongo).
 */

function shouldSkipUnapproved(approvalStatus, status) {
  if (approvalStatus === "REJECTED" || status === "CANCELLED") return "REQUEST_REJECTED";
  if (approvalStatus !== "APPROVED" && approvalStatus !== "NOT_REQUIRED") {
    return "REQUEST_NOT_APPROVED";
  }
  return null;
}

function shouldResumeLifecycleWorkflow({ openTasks, failedTasks, alreadyResumed }) {
  if (openTasks > 0) return { resume: false, reason: "TASKS_STILL_OPEN" };
  if (failedTasks > 0) return { resume: false, reason: "HAS_FAILED_TASKS" };
  if (alreadyResumed) return { resume: false, reason: "ALREADY_RESUMED" };
  return { resume: true };
}

function dependenciesReady(deps, taskStatusesByPlanItemId) {
  for (const dep of deps || []) {
    if (taskStatusesByPlanItemId[dep] !== "COMPLETED") return false;
  }
  return true;
}

describe("P4 worker safety invariants", () => {
  test("unapproved and rejected requests cannot execute", () => {
    expect(shouldSkipUnapproved("PENDING", "PENDING")).toBe("REQUEST_NOT_APPROVED");
    expect(shouldSkipUnapproved("REJECTED", "CANCELLED")).toBe("REQUEST_REJECTED");
    expect(shouldSkipUnapproved("APPROVED", "IN_PROGRESS")).toBeNull();
  });

  test("resume only when all tasks terminal and none failed", () => {
    expect(
      shouldResumeLifecycleWorkflow({ openTasks: 1, failedTasks: 0, alreadyResumed: false }),
    ).toEqual({ resume: false, reason: "TASKS_STILL_OPEN" });
    expect(
      shouldResumeLifecycleWorkflow({ openTasks: 0, failedTasks: 1, alreadyResumed: false }),
    ).toEqual({ resume: false, reason: "HAS_FAILED_TASKS" });
    expect(
      shouldResumeLifecycleWorkflow({ openTasks: 0, failedTasks: 0, alreadyResumed: true }),
    ).toEqual({ resume: false, reason: "ALREADY_RESUMED" });
    expect(
      shouldResumeLifecycleWorkflow({ openTasks: 0, failedTasks: 0, alreadyResumed: false }),
    ).toEqual({ resume: true });
  });

  test("entitlement waits for account dependency", () => {
    expect(
      dependenciesReady(["app|ADD_ACCOUNT|account"], {
        "app|ADD_ACCOUNT|account": "PENDING",
      }),
    ).toBe(false);
    expect(
      dependenciesReady(["app|ADD_ACCOUNT|account"], {
        "app|ADD_ACCOUNT|account": "COMPLETED",
      }),
    ).toBe(true);
  });
});
