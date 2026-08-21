import { useCallback, useEffect, useRef, useState } from "react";
import { workflowTaskQueueApi } from "../features/remediation-events/services/api";

function buildIdsKey(targetIds = []) {
  return [...new Set(targetIds.map(String).filter(Boolean))].sort().join(",");
}

/**
 * Queue-first status for uncorrelated accounts (workflow_task_queue).
 */
export default function useQueueTaskPageStatus({ action = "IAM_ORPHAN_REVIEW", targetIds = [], enabled = true }) {
  const [queuedTargets, setQueuedTargets] = useState({});
  const [loading, setLoading] = useState(false);
  const idsKey = buildIdsKey(targetIds);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !idsKey || action !== "IAM_ORPHAN_REVIEW") {
      setQueuedTargets({});
      return {};
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await workflowTaskQueueApi.checkIamOrphanQueued(idsKey.split(","));
      if (requestId !== requestIdRef.current) return {};
      const data = res.data?.data || {};
      const map = data.queuedTargets || {};
      setQueuedTargets(map);
      return map;
    } catch {
      if (requestId === requestIdRef.current) setQueuedTargets({});
      return {};
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [enabled, action, idsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getQueuedInfo = useCallback(
    (id) => {
      const hit = queuedTargets[String(id)];
      if (!hit) return null;
      return {
        eventId: hit.taskId,
        taskId: hit.taskId,
        queueSlug: "iam-orphan-review",
        status: hit.status,
      };
    },
    [queuedTargets],
  );

  return { queuedTargets, loading, refresh, getQueuedInfo };
}
