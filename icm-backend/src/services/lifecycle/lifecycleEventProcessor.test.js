import { describe, expect, test } from "@jest/globals";
import { isGenericJmlOrchestrationEnabled } from "./genericJmlOrchestrationFlag.js";
import { isGenericMoverOrchestrationEnabled } from "./genericMoverOrchestrationFlag.js";
import { processLifecycleEvent } from "./lifecycleEventProcessor.js";

function baseEvent(overrides = {}) {
  return {
    _id: "64ffffffffffffffffffffff",
    tenantId: "64aaaaaaaaaaaaaaaaaaaaa1",
    identityId: "64bbbbbbbbbbbbbbbbbbbbbb",
    eventType: "JOINER",
    lifecycleType: "JOINER",
    jmlCorrelationId: "JML-20260816-p5",
    syncJobId: "sync-1",
    metadata: {},
    ...overrides,
  };
}

describe("GENERIC_JML_ORCHESTRATION_ENABLED flag", () => {
  test("defaults to false", () => {
    expect(isGenericJmlOrchestrationEnabled({})).toBe(false);
    expect(isGenericJmlOrchestrationEnabled({ GENERIC_JML_ORCHESTRATION_ENABLED: "" })).toBe(
      false,
    );
  });

  test("true / 1 enable generic path", () => {
    expect(
      isGenericJmlOrchestrationEnabled({ GENERIC_JML_ORCHESTRATION_ENABLED: "true" }),
    ).toBe(true);
    expect(
      isGenericJmlOrchestrationEnabled({ GENERIC_JML_ORCHESTRATION_ENABLED: "1" }),
    ).toBe(true);
  });
});

describe("GENERIC_MOVER_ORCHESTRATION_ENABLED flag", () => {
  test("defaults to false", () => {
    expect(isGenericMoverOrchestrationEnabled({})).toBe(false);
    expect(
      isGenericMoverOrchestrationEnabled({ GENERIC_MOVER_ORCHESTRATION_ENABLED: "" }),
    ).toBe(false);
  });

  test("true / 1 enable mover planning path", () => {
    expect(
      isGenericMoverOrchestrationEnabled({ GENERIC_MOVER_ORCHESTRATION_ENABLED: "true" }),
    ).toBe(true);
    expect(
      isGenericMoverOrchestrationEnabled({ GENERIC_MOVER_ORCHESTRATION_ENABLED: "1" }),
    ).toBe(true);
  });
});

describe("processLifecycleEvent P5 routing", () => {
  test("flag OFF → JOINER uses legacy evaluator only", async () => {
    const calls = { legacy: 0, generic: 0, mover: 0, leaver: 0 };
    const result = await processLifecycleEvent(baseEvent(), {
      isGenericJmlOrchestrationEnabled: () => false,
      findBlockingHigherPriorityEvent: async () => null,
      evaluateJoinersForIdentities: async () => {
        calls.legacy += 1;
        return { processed: 1, requests: [{ provisioningRequestId: "r1" }] };
      },
      startGenericPlanOrchestration: async () => {
        calls.generic += 1;
        return { success: true };
      },
      attachCorrelationToOpenRequests: async () => {},
      markLifecycleEventCompleted: async () => ({}),
      markLifecycleEventFailed: async () => ({}),
    });

    expect(result.ok).toBe(true);
    expect(result.result.route).toBe("LEGACY");
    expect(calls).toEqual({ legacy: 1, generic: 0, mover: 0, leaver: 0 });
  });

  test("flag ON → JOINER uses generic orchestration only", async () => {
    const calls = { legacy: 0, generic: 0 };
    let completedPatch = null;
    const result = await processLifecycleEvent(baseEvent(), {
      isGenericJmlOrchestrationEnabled: () => true,
      findBlockingHigherPriorityEvent: async () => null,
      loadIdentityForEvent: async () => ({
        _id: "64bbbbbbbbbbbbbbbbbbbbbb",
        tenantId: "64aaaaaaaaaaaaaaaaaaaaa1",
        department: "IT",
      }),
      evaluateJoinersForIdentities: async () => {
        calls.legacy += 1;
        return { processed: 1, requests: [] };
      },
      startGenericPlanOrchestration: async (args) => {
        calls.generic += 1;
        expect(args.lifecycleEvent._id).toBe("64ffffffffffffffffffffff");
        expect(args.context.jmlCorrelationId).toBe("JML-20260816-p5");
        expect(args.identity.department).toBe("IT");
        return {
          success: true,
          provisioningRequestId: "64cccccccccccccccccccccc",
          planId: "64dddddddddddddddddddddd",
          workflowExecutionId: "exec-1",
          totalOperations: 2,
          jmlCorrelationId: "JML-20260816-p5",
        };
      },
      markLifecycleEventCompleted: async (_id, patch) => {
        completedPatch = patch;
        return {};
      },
      markLifecycleEventFailed: async () => ({}),
    });

    expect(result.ok).toBe(true);
    expect(result.result.route).toBe("GENERIC");
    expect(calls).toEqual({ legacy: 0, generic: 1 });
    expect(String(completedPatch.provisioningRequestId)).toContain("64cc");
    expect(completedPatch.workflowExecutionId).toBe("exec-1");
    expect(completedPatch.metadata.processResult.route).toBe("GENERIC");
    expect(completedPatch.metadata.processResult.planId).toBe("64dddddddddddddddddddddd");
    expect(completedPatch.metadata.processResult.jmlCorrelationId).toBe("JML-20260816-p5");
  });

  test("flag ON + generic failure → event failed/retried, not completed", async () => {
    let completed = false;
    let failed = null;
    const result = await processLifecycleEvent(baseEvent(), {
      isGenericJmlOrchestrationEnabled: () => true,
      findBlockingHigherPriorityEvent: async () => null,
      loadIdentityForEvent: async () => ({ _id: "id", tenantId: "t" }),
      startGenericPlanOrchestration: async () => ({
        success: false,
        error: "boom",
      }),
      evaluateJoinersForIdentities: async () => {
        throw new Error("legacy must not run");
      },
      markLifecycleEventCompleted: async () => {
        completed = true;
        return {};
      },
      markLifecycleEventFailed: async (_id, error) => {
        failed = error;
        return {};
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
    expect(completed).toBe(false);
    expect(failed).toMatch(/boom/);
  });

  test("REHIRE always uses legacy even when flag ON", async () => {
    const calls = { legacy: 0, generic: 0 };
    await processLifecycleEvent(baseEvent({ eventType: "REHIRE", lifecycleType: "REHIRE" }), {
      isGenericJmlOrchestrationEnabled: () => true,
      findBlockingHigherPriorityEvent: async () => null,
      evaluateJoinersForIdentities: async () => {
        calls.legacy += 1;
        return { processed: 1, requests: [] };
      },
      startGenericPlanOrchestration: async () => {
        calls.generic += 1;
        return { success: true };
      },
      attachCorrelationToOpenRequests: async () => {},
      markLifecycleEventCompleted: async () => ({}),
      markLifecycleEventFailed: async () => ({}),
    });
    expect(calls).toEqual({ legacy: 1, generic: 0 });
  });

  test("MOVER flag OFF remains detection-only; LEAVER still uses legacy consumer", async () => {
    const calls = { mover: 0, leaver: 0, legacy: 0, generic: 0 };
    let completedPatch = null;
    const deps = {
      isGenericJmlOrchestrationEnabled: () => true,
      isGenericMoverOrchestrationEnabled: () => false,
      findBlockingHigherPriorityEvent: async () => null,
      startMoverProvisioningFromEvent: async () => {
        calls.mover += 1;
        return { provisioningRequestId: "m1" };
      },
      startLeaverProvisioningFromEvent: async () => {
        calls.leaver += 1;
        return { provisioningRequestId: "l1" };
      },
      evaluateJoinersForIdentities: async () => {
        calls.legacy += 1;
        return {};
      },
      startGenericPlanOrchestration: async () => {
        calls.generic += 1;
        return { success: true };
      },
      markLifecycleEventCompleted: async (_id, patch) => {
        completedPatch = patch;
        return {};
      },
      markLifecycleEventFailed: async () => ({}),
    };

    const mover = await processLifecycleEvent(
      baseEvent({
        eventType: "MOVER",
        lifecycleType: "MOVER",
        changeSet: {
          changedAttributes: [
            { attribute: "department", before: "Finance", after: "IT" },
          ],
        },
      }),
      deps,
    );
    expect(mover.ok).toBe(true);
    expect(mover.result.route).toBe("DETECTION_ONLY");
    expect(mover.result.reason).toBe("MOVER_DETECTION_ONLY");
    expect(calls.mover).toBe(0);
    expect(calls.generic).toBe(0);
    expect(completedPatch.metadata.processResult.route).toBe("DETECTION_ONLY");

    await processLifecycleEvent(baseEvent({ eventType: "LEAVER", lifecycleType: "LEAVER" }), deps);
    expect(calls).toEqual({ mover: 0, leaver: 1, legacy: 0, generic: 0 });
  });

  test("MOVER flag ON → planning-only generic path (no workflow/tasks)", async () => {
    const calls = { generic: 0, leaver: 0, legacy: 0 };
    let completedPatch = null;
    let orchestrationArgs = null;
    const result = await processLifecycleEvent(
      baseEvent({
        eventType: "MOVER",
        lifecycleType: "MOVER",
        jmlCorrelationId: "JML-20260816-p7",
      }),
      {
        isGenericMoverOrchestrationEnabled: () => true,
        findBlockingHigherPriorityEvent: async () => null,
        loadIdentityForEvent: async () => ({
          _id: "64bbbbbbbbbbbbbbbbbbbbbb",
          tenantId: "64aaaaaaaaaaaaaaaaaaaaa1",
          department: "IT",
        }),
        startGenericPlanOrchestration: async (args) => {
          calls.generic += 1;
          orchestrationArgs = args;
          return {
            success: true,
            planningOnly: true,
            provisioningRequestId: "64cccccccccccccccccccccc",
            planId: "64dddddddddddddddddddddd",
            workflowExecutionId: "must-be-cleared",
            totalOperations: 3,
            jmlCorrelationId: "JML-20260816-p7",
          };
        },
        evaluateJoinersForIdentities: async () => {
          calls.legacy += 1;
          return {};
        },
        startLeaverProvisioningFromEvent: async () => {
          calls.leaver += 1;
          return {};
        },
        markLifecycleEventCompleted: async (_id, patch) => {
          completedPatch = patch;
          return {};
        },
        markLifecycleEventFailed: async () => ({}),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.result.route).toBe("PLANNING_ONLY");
    expect(result.result.planningOnly).toBe(true);
    expect(result.result.workflowExecutionId).toBeNull();
    expect(calls).toEqual({ generic: 1, leaver: 0, legacy: 0 });
    expect(orchestrationArgs.context).toMatchObject({
      lifecycleType: "MOVER",
      requestType: "MOVER",
      planningOnly: true,
      jmlCorrelationId: "JML-20260816-p7",
    });
    expect(orchestrationArgs.identity.department).toBe("IT");
    expect(completedPatch.metadata.processResult.route).toBe("PLANNING_ONLY");
    expect(completedPatch.metadata.processResult.planningOnly).toBe(true);
    expect(completedPatch.metadata.processResult.planId).toBe("64dddddddddddddddddddddd");
    expect(completedPatch.workflowExecutionId).toBeUndefined();
  });

  test("MOVER planning failure → event failed, not completed", async () => {
    let completed = false;
    let failed = null;
    const result = await processLifecycleEvent(
      baseEvent({ eventType: "MOVER", lifecycleType: "MOVER" }),
      {
        isGenericMoverOrchestrationEnabled: () => true,
        findBlockingHigherPriorityEvent: async () => null,
        loadIdentityForEvent: async () => ({
          _id: "64bbbbbbbbbbbbbbbbbbbbbb",
          tenantId: "64aaaaaaaaaaaaaaaaaaaaa1",
        }),
        startGenericPlanOrchestration: async () => ({
          success: false,
          error: "delta boom",
        }),
        markLifecycleEventCompleted: async () => {
          completed = true;
          return {};
        },
        markLifecycleEventFailed: async (_id, error) => {
          failed = error;
          return {};
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/delta boom/);
    expect(completed).toBe(false);
    expect(failed).toMatch(/delta boom/);
  });

  test("empty-delta generic success still completes event", async () => {
    const result = await processLifecycleEvent(baseEvent(), {
      isGenericJmlOrchestrationEnabled: () => true,
      findBlockingHigherPriorityEvent: async () => null,
      loadIdentityForEvent: async () => ({ _id: "id", tenantId: "t" }),
      startGenericPlanOrchestration: async () => ({
        success: true,
        provisioningRequestId: "r1",
        planId: "p1",
        workflowExecutionId: "w1",
        totalOperations: 0,
        jmlCorrelationId: "JML-20260816-p5",
      }),
      markLifecycleEventCompleted: async () => ({}),
      markLifecycleEventFailed: async () => {
        throw new Error("should not fail");
      },
    });
    expect(result.ok).toBe(true);
    expect(result.result.totalOperations).toBe(0);
    expect(result.result.route).toBe("GENERIC");
  });

  test("generic path never invokes legacy evaluator (exclusive routing)", async () => {
    let legacyCalled = false;
    await processLifecycleEvent(baseEvent(), {
      isGenericJmlOrchestrationEnabled: () => true,
      findBlockingHigherPriorityEvent: async () => null,
      loadIdentityForEvent: async () => ({ _id: "id", tenantId: "t" }),
      evaluateJoinersForIdentities: async () => {
        legacyCalled = true;
        return {};
      },
      startGenericPlanOrchestration: async () => ({
        success: true,
        provisioningRequestId: "r-reuse",
        planId: "p-reuse",
        workflowExecutionId: "w-reuse",
        totalOperations: 1,
        jmlCorrelationId: "JML-20260816-p5",
      }),
      markLifecycleEventCompleted: async () => ({}),
      markLifecycleEventFailed: async () => ({}),
    });
    expect(legacyCalled).toBe(false);
  });
});
