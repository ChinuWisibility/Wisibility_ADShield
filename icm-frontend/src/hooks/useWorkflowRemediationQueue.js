import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { workflowRemediationApi } from "../features/workflow-remediation-queue/services/api";
import { workflowRemediationQueuePath } from "../features/workflow-remediation-queue/paths";

export function useWorkflowRemediationQueue({ eventType, queueSlug }) {
  const navigate = useNavigate();

  const navigateToQueue = useCallback(
    (eventId) => {
      navigate(workflowRemediationQueuePath(queueSlug, eventId ? { eventId } : {}));
    },
    [navigate, queueSlug],
  );

  const checkQueuedTargets = useCallback(async ({ eventType: type, targetIds }) => {
    const res = await workflowRemediationApi.checkQueued({
      eventType: type || eventType,
      targetIds,
    });
    return res.data?.data || { alreadyQueued: [], availableIds: targetIds || [] };
  }, [eventType]);

  const manualEnqueue = useCallback(
    async (payload) => {
      const res = await workflowRemediationApi.manualEnqueue({
        eventType: payload.eventType || eventType,
        ...payload,
      });
      const data = res.data?.data || {};
      const eventId = data.event?.eventId;
      if (eventId && data.created) {
        navigateToQueue(eventId);
      }
      return data;
    },
    [eventType, navigateToQueue],
  );

  const loadWorkflows = useCallback(
    async (triggerType) => {
      const res = await workflowRemediationApi.workflows({
        eventType,
        trigger: triggerType || undefined,
      });
      return res.data?.data || [];
    },
    [eventType],
  );

  return {
    navigateToQueue,
    checkQueuedTargets,
    manualEnqueue,
    loadWorkflows,
  };
}

export default useWorkflowRemediationQueue;
