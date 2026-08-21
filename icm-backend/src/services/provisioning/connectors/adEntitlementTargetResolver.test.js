import { describe, expect, jest, test } from "@jest/globals";
import { resolveAdEntitlementTarget } from "./adEntitlementTargetResolver.js";

const TENANT = "64aaaaaaaaaaaaaaaaaaaaa1";
const APP = "64bbbbbbbbbbbbbbbbbbbbbb";
const ENT = "64cccccccccccccccccccccc";
const GROUP_DN = "CN=VPN,OU=Groups,DC=example,DC=com";

const application = {
  _id: APP,
  tenantId: TENANT,
  name: "Directory",
};

function provider(rows, capture = {}) {
  return jest.fn(async () => ({
    find(query) {
      capture.query = query;
      return {
        limit(limit) {
          capture.limit = limit;
          return { lean: async () => rows };
        },
      };
    },
  }));
}

function row(overrides = {}) {
  return {
    _id: ENT,
    applicationId: APP,
    entitlement_id: "S-1-5-21-100",
    object_sid: "S-1-5-21-100",
    entitlement_type: "AD_GROUP",
    source_dn: GROUP_DN,
    ...overrides,
  };
}

describe("AD entitlement target resolver", () => {
  test("resolves dynamic catalog ObjectId to authoritative group DN", async () => {
    const capture = {};
    const result = await resolveAdEntitlementTarget({
      tenantId: TENANT,
      application,
      entitlement: { entitlementId: ENT },
      modelProvider: provider([row()], capture),
    });
    expect(result).toEqual({
      catalogId: ENT,
      objectSid: "S-1-5-21-100",
      groupDn: GROUP_DN,
    });
    expect(capture.query.applicationId).toBe(APP);
    expect(capture.limit).toBe(3);
  });

  test("resolves SID native ID without trusting display name", async () => {
    const result = await resolveAdEntitlementTarget({
      tenantId: TENANT,
      application,
      entitlement: { nativeId: "S-1-5-21-100", name: "Untrusted Name" },
      modelProvider: provider([row()]),
    });
    expect(result.groupDn).toBe(GROUP_DN);
  });

  test("rejects tenant mismatch before catalog access", async () => {
    const modelProvider = provider([row()]);
    await expect(
      resolveAdEntitlementTarget({
        tenantId: "64dddddddddddddddddddddd",
        application,
        entitlement: { entitlementId: ENT },
        modelProvider,
      }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(modelProvider).not.toHaveBeenCalled();
  });

  test("rejects missing and ambiguous catalog targets", async () => {
    await expect(
      resolveAdEntitlementTarget({
        tenantId: TENANT,
        application,
        entitlement: { entitlementId: ENT },
        modelProvider: provider([]),
      }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_NOT_FOUND" });
    await expect(
      resolveAdEntitlementTarget({
        tenantId: TENANT,
        application,
        entitlement: { entitlementId: ENT },
        modelProvider: provider([row(), row({ _id: "64eeeeeeeeeeeeeeeeeeeeee" })]),
      }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_AMBIGUOUS" });
  });

  test("rejects non-group, wrong-app, and missing-DN rows", async () => {
    for (const [catalogRow, code] of [
      [row({ entitlement_type: "ROLE" }), "ENTITLEMENT_NOT_AD_GROUP"],
      [
        row({ applicationId: "64dddddddddddddddddddddd" }),
        "ENTITLEMENT_APPLICATION_MISMATCH",
      ],
      [row({ source_dn: "", groupDN: "" }), "ENTITLEMENT_GROUP_DN_MISSING"],
    ]) {
      await expect(
        resolveAdEntitlementTarget({
          tenantId: TENANT,
          application,
          entitlement: { entitlementId: ENT },
          modelProvider: provider([catalogRow]),
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  test("rejects caller DN that differs from catalog DN", async () => {
    await expect(
      resolveAdEntitlementTarget({
        tenantId: TENANT,
        application,
        entitlement: {
          nativeId: "CN=Other,OU=Groups,DC=example,DC=com",
        },
        modelProvider: provider([row()]),
      }),
    ).rejects.toMatchObject({ code: "ENTITLEMENT_TARGET_MISMATCH" });
  });
});
