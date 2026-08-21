import { useCallback, useEffect, useRef, useState } from "react";
import { workflowRemediationApi } from "../features/workflow-remediation-queue/services/api";

function buildIdsKey(targetIds = []) {
  return [...new Set(targetIds.map(String).filter(Boolean))].sort().join(",");
}

/**
 * Batch item-level queue status for all visible target IDs on a source page.
 */
export default function useWrqPageQueueStatus({ eventType, targetIds = [], enabled = true }) {
  const [queuedTargets, setQueuedTargets] = useState({});
  const [loading, setLoading] = useState(false);
  const idsKey = buildIdsKey(targetIds);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !eventType || !idsKey) {
      setQueuedTargets({});
      return {};
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await workflowRemediationApi.checkQueued({
        eventType,
        targetIds: idsKey.split(","),
      });
      if (requestId !== requestIdRef.current) return {};
      const data = res.data?.data || {};
      const map = data.queuedTargets || {};
      setQueuedTargets(map);
      return map;
    } catch {
      if (requestId === requestIdRef.current) {
        setQueuedTargets({});
      }
      return {};
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, eventType, idsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isQueued = useCallback((id) => Boolean(queuedTargets[String(id)]), [queuedTargets]);

  const getQueuedInfo = useCallback(
    (id) => queuedTargets[String(id)] || null,
    [queuedTargets],
  );

  return {
    queuedTargets,
    loading,
    refresh,
    isQueued,
    getQueuedInfo,
  };
}
