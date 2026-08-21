/**
 * Unit tests for identity entitlement sync helpers (no live Mongo required for pure fns).
 */
import {
  buildProjectionRow,
} from "../identityEntitlementSyncService.js";
import mongoose from "mongoose";

describe("identityEntitlementSyncService helpers", () => {
  const tenantId = new mongoose.Types.ObjectId();
  const identityId = new mongoose.Types.ObjectId();
  const applicationId = new mongoose.Types.ObjectId();
  const accountId = new mongoose.Types.ObjectId();
  const entitlementId = new mongoose.Types.ObjectId();

  test("buildProjectionRow returns null without account/entitlement ids", () => {
    const row = buildProjectionRow({
      tenantId,
      tenantSlug: "t",
      identity: { _id: identityId, displayName: "A" },
      application: { _id: applicationId, name: "App" },
      link: {},
      accountDoc: {},
      entitlementDoc: {},
      syncedAt: new Date(),
    });
    expect(row).toBeNull();
  });

  test("buildProjectionRow builds unique natural key fields", () => {
    const syncedAt = new Date();
    const row = buildProjectionRow({
      tenantId,
      tenantSlug: "wisibility",
      identity: {
        _id: identityId,
        displayName: "Jane",
        email: "j@x.com",
        department: "Eng",
        title: "Eng",
        attributes: { uid: "jane" },
      },
      application: { _id: applicationId, name: "Workday" },
      link: { accountId },
      accountDoc: { _id: accountId, status: "ACTIVE", username: "jane" },
      entitlementDoc: {
        _id: entitlementId,
        entitlement_name: "RoleA",
        is_privilege: true,
        risk_level: "HIGH",
      },
      syncedAt,
    });
    expect(row).toMatchObject({
      tenantId,
      identityId,
      applicationId,
      accountId,
      entitlementId,
      entitlementDisplayName: "RoleA",
      assignmentType: "DIRECT",
      entitlementSnapshot: { isPrivileged: true, riskLevel: "HIGH" },
    });
    expect(row.nativeIdentity).toBe("jane");
  });
});
