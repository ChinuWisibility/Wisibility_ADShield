import { describe, expect, test } from "@jest/globals";
import { collectProjectionEntitlements } from "./actualAccessService.js";

const APP = "app-ad";
const DYN_USER = "64aaaaaaaaaaaaaaaaaaaaa1";
const AGG_ID = "64bbbbbbbbbbbbbbbbbbbbbb";

function projectionMap(entries) {
  return new Map(entries);
}

describe("collectProjectionEntitlements", () => {
  test("hits DynamicUser accountId candidates used by the projection cube", () => {
    const projection = projectionMap([
      [
        `${APP}:${DYN_USER}`,
        [{ entitlementId: "e1", entitlementName: "VPN", displayName: "VPN" }],
      ],
    ]);

    expect(
      collectProjectionEntitlements(projection, APP, [AGG_ID, DYN_USER]).map(
        (e) => e.entitlementId,
      ),
    ).toEqual(["e1"]);
  });

  test("does not merge entitlements when multiple distinct projection accounts match", () => {
    const projection = projectionMap([
      [
        `${APP}:${DYN_USER}`,
        [{ entitlementId: "e1", entitlementName: "VPN", displayName: "VPN" }],
      ],
      [
        `${APP}:${AGG_ID}`,
        [{ entitlementId: "e-wrong", entitlementName: "Wrong", displayName: "Wrong" }],
      ],
    ]);

    expect(
      collectProjectionEntitlements(projection, APP, [AGG_ID, DYN_USER]),
    ).toEqual([]);
  });

  test("bridges Aggregation id miss via single projected account for the app", () => {
    const projection = projectionMap([
      [
        `${APP}:${DYN_USER}`,
        [
          { entitlementId: "e-vpn", entitlementName: "VPN", displayName: "VPN" },
          { entitlementId: "e-it", entitlementName: "IT", displayName: "IT" },
        ],
      ],
    ]);

    const result = collectProjectionEntitlements(projection, APP, [AGG_ID, "native-guid"]);
    expect(result.map((e) => e.entitlementId)).toEqual(["e-it", "e-vpn"]);
  });

  test("does not merge entitlements when multiple projected accounts exist for the app", () => {
    const projection = projectionMap([
      [`${APP}:${DYN_USER}`, [{ entitlementId: "e1", entitlementName: "A", displayName: "A" }]],
      [
        `${APP}:64cccccccccccccccccccccc`,
        [{ entitlementId: "e2", entitlementName: "B", displayName: "B" }],
      ],
    ]);

    expect(collectProjectionEntitlements(projection, APP, [AGG_ID])).toEqual([]);
  });

  test("returns empty when projection is unavailable", () => {
    expect(collectProjectionEntitlements(null, APP, [DYN_USER])).toEqual([]);
  });
});
