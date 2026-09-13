/**
 * P6 refresh-boundary seam: authoritative BEFORE/AFTER handoff into lifecycle enqueue.
 * No Mongo — injects enqueueBatch.
 */

import { describe, expect, test } from "@jest/globals";
import { enqueueLifecycleTransitionsFromRefresh } from "./identityProfileRefreshService.js";
import { detectIdentityLifecycleChanges } from "../lifecycle/lifecycleDetectionService.js";

describe("P6 identity refresh lifecycle seam", () => {
  test("maps persisted before/after transitions into enqueue payload", async () => {
    const captured = [];
    const before = {
      _id: "id-1",
      department: "Finance",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const after = { ...before, department: "IT" };

    const result = await enqueueLifecycleTransitionsFromRefresh({
      transitions: [
        {
          tenantId: "tenant-a",
          identityId: after._id,
          before,
          after,
        },
        { tenantId: "tenant-a", identityId: null, after }, // dropped
        { tenantId: "tenant-a", identityId: "x", after: null }, // dropped
      ],
      syncJobId: "identity-refresh:profile:1",
      triggeredBy: "IDENTITY_REFRESH",
      sourceApplicationId: "app-1",
      jmlCorrelationId: "JML-20260816-p6seam",
      enqueueBatch: async (payload) => {
        captured.push(...payload);
        return { count: payload.length, results: [] };
      },
    });

    expect(result.count).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      tenantId: "tenant-a",
      identityId: "id-1",
      syncJobId: "identity-refresh:profile:1",
      triggeredBy: "IDENTITY_REFRESH",
      sourceApplicationId: "app-1",
      jmlCorrelationId: "JML-20260816-p6seam",
      before: expect.objectContaining({ department: "Finance" }),
      after: expect.objectContaining({ department: "IT" }),
    });

    const detection = detectIdentityLifecycleChanges(captured[0].before, captured[0].after);
    expect(detection.lifecycleEvents).toEqual(["MOVER"]);
  });

  test("empty transitions short-circuit without enqueue", async () => {
    let called = false;
    const result = await enqueueLifecycleTransitionsFromRefresh({
      transitions: [],
      enqueueBatch: async () => {
        called = true;
        return { count: 0 };
      },
    });
    expect(result).toEqual({ count: 0 });
    expect(called).toBe(false);
  });

  test("identical after/after refresh produces no MOVER detection", () => {
    const after = {
      department: "IT",
      lifecycleState: "ACTIVE",
      isActive: true,
    };
    const detection = detectIdentityLifecycleChanges(after, { ...after });
    expect(detection.changed).toBe(false);
    expect(detection.lifecycleEvents).toEqual([]);
  });
});
