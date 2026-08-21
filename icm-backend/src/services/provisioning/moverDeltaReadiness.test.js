/**
 * P6 offline MOVER delta readiness.
 *
 * Documents that existing Access Delta ADD/REMOVE/RETAIN behavior works for a
 * MOVER-shaped Desired vs correlated Actual access comparison.
 * Does NOT invoke provisioning, workflows, workers, or connectors.
 */

import { describe, expect, test } from "@jest/globals";
import { calculateAccessDelta } from "./accessDeltaService.js";

const TENANT = "tenant-mover";
const IDENTITY = "identity-mover";
const AD = "app-ad";
const M365 = "app-m365";
const ORACLE = "app-oracle";

describe("P6 MOVER access-delta readiness (offline)", () => {
  test("MOVER desired vs actual → ADD / REMOVE / RETAIN without provisioning", () => {
    const desiredAccess = {
      tenantId: TENANT,
      identityId: IDENTITY,
      lifecycleType: "MOVER",
      lifecycleEventId: "mover-event-1",
      jmlCorrelationId: "JML-20260816-mover-delta",
      applications: [
        {
          applicationId: AD,
          applicationName: "AD",
          accountRequired: true,
          attributes: { department: "IT" },
          entitlements: [
            { entitlementId: "grp-it", name: "IT Users" },
            { entitlementId: "grp-finance", name: "Finance Users" },
          ],
        },
        {
          applicationId: M365,
          applicationName: "M365",
          accountRequired: true,
          attributes: {},
          entitlements: [{ entitlementId: "lic-e3", name: "E3" }],
        },
      ],
    };

    const actualAccess = {
      tenantId: TENANT,
      identityId: IDENTITY,
      applications: [
        {
          applicationId: AD,
          applicationName: "AD",
          account: {
            exists: true,
            nativeId: "alice",
            attributes: { department: "Finance" },
          },
          entitlements: [
            { entitlementId: "grp-finance", name: "Finance Users" },
            { entitlementId: "grp-legacy", name: "Legacy" },
          ],
        },
        {
          applicationId: ORACLE,
          applicationName: "Oracle",
          account: { exists: true, nativeId: "alice-ora", attributes: {} },
          entitlements: [{ entitlementId: "ora-role", name: "ORA_USER" }],
        },
      ],
      metadata: { source: "IGA_AGGREGATION_AND_CORRELATION" },
    };

    const delta = calculateAccessDelta(desiredAccess, actualAccess);
    const byApp = Object.fromEntries(
      delta.applications.map((a) => [a.applicationId, a]),
    );

    expect(byApp[AD].account.operation).toBe("RETAIN_ACCOUNT");
    expect(byApp[AD].account.attributeOperation).toBe("UPDATE_ACCOUNT");
    expect(byApp[AD].entitlements.add).toEqual([
      expect.objectContaining({ entitlementId: "grp-it" }),
    ]);
    expect(byApp[AD].entitlements.retain).toEqual([
      expect.objectContaining({ entitlementId: "grp-finance" }),
    ]);
    expect(byApp[AD].entitlements.remove).toEqual([
      expect.objectContaining({ entitlementId: "grp-legacy" }),
    ]);

    expect(byApp[M365].account.operation).toBe("ADD_ACCOUNT");
    expect(byApp[M365].entitlements.add).toEqual([
      expect.objectContaining({ entitlementId: "lic-e3" }),
    ]);

    expect(byApp[ORACLE].account.operation).toBe("REMOVE_ACCOUNT");
    expect(byApp[ORACLE].entitlements.remove).toEqual([
      expect.objectContaining({ entitlementId: "ora-role" }),
    ]);

    expect(delta.lifecycleType).toBe("MOVER");
    expect(delta.metadata).toMatchObject({
      evaluationMode: "ACCESS_DELTA_ONLY",
      targetWrites: false,
      provisioningTasksCreated: false,
      workflowExecuted: false,
      connectorInvoked: false,
    });
  });
});
