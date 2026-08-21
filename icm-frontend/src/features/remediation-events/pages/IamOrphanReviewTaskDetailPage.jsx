import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import QueueTaskDetailPanel from "../components/QueueTaskDetailPanel";
import RemediationPageShell from "../components/RemediationPageShell";
import { workflowTaskQueueApi } from "../services/api";
import { REMEDIATION_EVENT_CATALOG } from "../constants";
import { IAM_ORPHAN_REVIEW_LIST_PATH } from "../paths";
import {
  formatIamOrphanReviewTaskTitle,
  formatIamOrphanReviewTaskContext,
} from "../utils/queueTaskDisplay";

function taskSnapshotKey(task) {
  if (!task) return "";
  return [
    task.status,
    task.workflowName,
    task.failureReason,
    task.runId,
    task.executionStartedAt,
    task.completedAt,
    Array.isArray(task.stepLog) ? task.stepLog.length : 0,
    task.stepLog?.[task.stepLog.length - 1]?.at,
    task.context?.triggerMode,
  ].join("|");
}

function mergeTaskIfChanged(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  return taskSnapshotKey(prev) === taskSnapshotKey(next) ? prev : next;
}

export default function IamOrphanReviewTaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  const config = REMEDIATION_EVENT_CATALOG.find((c) => c.slug === "iam-orphan-review");

  const load = useCallback((options = {}) => {
    if (!taskId) return Promise.resolve();
    if (inFlightRef.current) return Promise.resolve();

    const silent = Boolean(options.silent);
    inFlightRef.current = true;
    if (silent) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
      setError(null);
    }

    return workflowTaskQueueApi
      .getTask(taskId)
      .then((r) => {
        const data = r.data?.data;
        if (!data) throw new Error("Task not found");
        setTask((prev) => mergeTaskIfChanged(prev, data));
        setError(null);
      })
      .catch((err) => {
        if (!silent) {
          setTask(null);
          setError(err?.response?.data?.message || err?.message || "Failed to load task");
        }
      })
      .finally(() => {
        inFlightRef.current = false;
        if (silent) setRefreshing(false);
        else setInitialLoading(false);
      });
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleLaunchImmediately = useCallback(async () => {
    if (!task?.taskId || isLaunching) return;
    setIsLaunching(true);
    try {
      await workflowTaskQueueApi.launchImmediately(task.taskId);
      await load({ silent: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to launch task");
    } finally {
      setIsLaunching(false);
    }
  }, [task?.taskId, isLaunching, load]);

  const canMarkComplete =
    task && ["WAITING", "IN_PROGRESS", "FAILED"].includes(task.status);

  const canCancel =
    task && ["NEW", "WAITING", "FAILED"].includes(task.status);

  const handleMarkComplete = useCallback(async () => {
    if (!task?.taskId || isMarkingComplete) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      "Mark this IAM orphan review task as complete?",
    );
    if (!ok) return;
    setIsMarkingComplete(true);
    setError(null);
    try {
      await workflowTaskQueueApi.markComplete(task.taskId);
      await load({ silent: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to mark complete");
    } finally {
      setIsMarkingComplete(false);
    }
  }, [task?.taskId, isMarkingComplete, load]);

  const handleCancel = useCallback(async () => {
    if (!task?.taskId || isCancelling) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      "Cancel this pending IAM orphan review? Access will not be changed.",
    );
    if (!ok) return;
    setIsCancelling(true);
    setError(null);
    try {
      await workflowTaskQueueApi.cancel(task.taskId);
      await load({ silent: true });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to cancel task");
    } finally {
      setIsCancelling(false);
    }
  }, [task?.taskId, isCancelling, load]);

  const title = task ? formatIamOrphanReviewTaskTitle(task) : "Task details";
  const context = task ? formatIamOrphanReviewTaskContext(task) : config?.description;
  const showInitialLoad = initialLoading && !task;

  return (
    <RemediationPageShell
      eyebrow="Governance · Remediation Framework"
      title={showInitialLoad ? "Loading task…" : title}
      subtitle={showInitialLoad ? config?.description : context}
      actions={(
        <>
          <Link to={IAM_ORPHAN_REVIEW_LIST_PATH} className="re-btn re-btn--secondary">
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
            Back
          </Link>
          <button
            type="button"
            className={`re-btn re-btn--secondary ${refreshing ? "is-refreshing" : ""}`}
            onClick={() => load({ silent: true })}
            disabled={initialLoading || refreshing}
            aria-busy={refreshing}
          >
            <RefreshRoundedIcon sx={{ fontSize: 18 }} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {task?.status === "NEW" && (
            <button
              type="button"
              className="re-btn re-btn--primary"
              onClick={handleLaunchImmediately}
              disabled={isLaunching || initialLoading || refreshing}
            >
              {isLaunching ? "Launching…" : "Launch immediately"}
            </button>
          )}
          {canMarkComplete && (
            <button
              type="button"
              className="re-btn re-btn--primary"
              onClick={handleMarkComplete}
              disabled={isMarkingComplete || initialLoading || refreshing}
            >
              {isMarkingComplete ? "Completing…" : "Mark Complete"}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              className="re-btn re-btn--secondary"
              onClick={handleCancel}
              disabled={isCancelling || initialLoading || refreshing}
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </>
      )}
    >
      {error && !task && !initialLoading ? (
        <div className="re-detail-panel re-detail-panel--empty">
          <h3>Task not found</h3>
          <p>{error}</p>
          <button
            type="button"
            className="re-btn re-btn--primary"
            onClick={() => navigate(IAM_ORPHAN_REVIEW_LIST_PATH)}
          >
            Back to tasks
          </button>
        </div>
      ) : showInitialLoad ? (
        <div className="re-detail-panel re-detail-panel--empty">
          <p>Loading task details…</p>
        </div>
      ) : (
        <div className="re-detail-page">
          <QueueTaskDetailPanel
            task={task}
            loading={false}
            refreshing={refreshing}
            hasSelection
            showClose={false}
            variant="iam-orphan-review"
          />
        </div>
      )}
    </RemediationPageShell>
  );
}
