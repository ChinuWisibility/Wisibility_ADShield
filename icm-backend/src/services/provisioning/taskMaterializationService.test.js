import { describe, expect, test } from "@jest/globals";
import { translateAccessDeltaToPlanItems } from "./provisioningPlanCompiler.js";
import { EXECUTION_CLASS } from "./provisioningCapabilityCatalog.js";
import { preserveTerminalMaterializationStatus } from "./taskMaterializationService.js";

/**
 * Pure helpers exercised without Mongo — materialization selection + identity rules.
 */

function selectExecutablePlanItems(operations = []) {
  return operations.filter(
    (op) => op?.executionClass === EXECUTION_CLASS.EXECUTABLE && op?.itemKey,
  );
}

function planItemIds(operations) {
  return operations.map((op) => op.itemKey);
}

describe("P4 task materialization contracts (offline)", () => {
  test("only EXECUTABLE items are selected for tasks", () => {
    const ops = [
      {
        itemKey: "a|ADD_ACCOUNT|account",
        executionClass: EXECUTION_CLASS.EXECUTABLE,
        operationType: "ADD_ACCOUNT",
      },
      {
        itemKey: "a|ADD_ENTITLEMENT|id:e1",
        executionClass: EXECUTION_CLASS.UNSUPPORTED,
        operationType: "ADD_ENTITLEMENT",
      },
      {
        itemKey: "b|ADD_ACCOUNT|account",
        executionClass: EXECUTION_CLASS.MANUAL,
        operationType: "ADD_ACCOUNT",
      },
      {
        itemKey: "c|ADD_ACCOUNT|account",
        executionClass: EXECUTION_CLASS.BLOCKED,
        operationType: "ADD_ACCOUNT",
      },
    ];
    const selected = selectExecutablePlanItems(ops);
    expect(selected).toHaveLength(1);
    expect(selected[0].itemKey).toBe("a|ADD_ACCOUNT|account");
  });

  test("three ADD_ENTITLEMENT items yield three distinct planItemIds", () => {
    const items = translateAccessDeltaToPlanItems({
      applications: [
        {
          applicationId: "app-ad",
          account: { operation: "RETAIN_ACCOUNT", attributeOperation: "NONE" },
          entitlements: {
            add: [
              { entitlementId: "e-it", name: "IT" },
              { entitlementId: "e-vpn", name: "VPN" },
              { entitlementId: "e-dev", name: "Dev" },
            ],
            retain: [],
            remove: [],
          },
        },
      ],
    });
    const ids = planItemIds(items);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.includes("ADD_ENTITLEMENT"))).toBe(true);
  });

  test("multi-application ADD_ACCOUNT yields distinct planItemIds", () => {
    const items = translateAccessDeltaToPlanItems({
      applications: [
        {
          applicationId: "app-a",
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
        {
          applicationId: "app-b",
          account: { operation: "ADD_ACCOUNT", attributeOperation: "NONE" },
          entitlements: { add: [], retain: [], remove: [] },
        },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0].itemKey).not.toBe(items[1].itemKey);
    expect(items.map((i) => i.applicationId).sort()).toEqual(["app-a", "app-b"]);
  });

  test("RETAIN creates no plan items / no tasks", () => {
    const items = translateAccessDeltaToPlanItems({
      applications: [
        {
          applicationId: "app-a",
          account: { operation: "RETAIN_ACCOUNT", attributeOperation: "NONE" },
          entitlements: {
            add: [],
            retain: [{ entitlementId: "e1" }],
            remove: [],
          },
        },
      ],
    });
    expect(items).toEqual([]);
    expect(selectExecutablePlanItems(items)).toEqual([]);
  });

  test("legacy planItemId format is deterministic", () => {
    const applicationId = "64cccccccccccccccccccccc";
    expect(`legacy:ADD_ACCOUNT:${applicationId}`).toBe(
      `legacy:ADD_ACCOUNT:${applicationId}`,
    );
  });

  test("re-materialization preserves terminal request and plan statuses", () => {
    expect(preserveTerminalMaterializationStatus("COMPLETED", "request")).toBe(true);
    expect(preserveTerminalMaterializationStatus("FAILED", "request")).toBe(true);
    expect(preserveTerminalMaterializationStatus("CANCELLED", "request")).toBe(true);
    expect(preserveTerminalMaterializationStatus("IN_PROGRESS", "request")).toBe(false);

    expect(preserveTerminalMaterializationStatus("COMPLETED", "plan")).toBe(true);
    expect(preserveTerminalMaterializationStatus("PARTIAL", "plan")).toBe(true);
    expect(preserveTerminalMaterializationStatus("FAILED", "plan")).toBe(true);
    expect(preserveTerminalMaterializationStatus("EXECUTING", "plan")).toBe(false);
  });
});
