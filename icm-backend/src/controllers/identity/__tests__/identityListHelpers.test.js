import {
  buildIdentityListProjection,
  buildIdentityListSort,
  buildIdentityTextSearchFilter,
} from "../identityController.js";

describe("All Identities list helpers", () => {
  test("keeps the established default and descending sort contracts", () => {
    expect(buildIdentityListSort("displayName", "asc")).toEqual({
      displayName: 1,
      _id: 1,
    });
    expect(buildIdentityListSort("displayName", "desc")).toEqual({
      displayName: -1,
      _id: 1,
    });
  });

  test("maps aliases and rejects unsafe sort paths", () => {
    expect(buildIdentityListSort("status", "asc")).toEqual({
      lifecycleState: 1,
      _id: 1,
    });
    expect(buildIdentityListSort("uid", "desc")).toEqual({
      "attributes.uid": -1,
      _id: 1,
    });
    expect(buildIdentityListSort("$where", "asc")).toEqual({
      displayName: 1,
      _id: 1,
    });
  });

  test("does not project unless the caller explicitly requests fields", () => {
    expect(buildIdentityListProjection()).toBeNull();
    expect(buildIdentityListProjection("")).toBeNull();
  });

  test("compact projection includes UI core, manager, and mapped attributes", () => {
    const projection = buildIdentityListProjection(
      "displayName,userId,managerId,status",
    ).split(" ");
    expect(projection).toEqual(
      expect.arrayContaining([
        "_id",
        "displayName",
        "firstName",
        "lastName",
        "managerId",
        "managerResolutionStatus",
        "lifecycleState",
        "attributes.display_name",
        "attributes.userId",
        "attributes.managerId",
      ]),
    );
  });

  test("compact projection ignores injection-like and dotted field names", () => {
    const projection = buildIdentityListProjection(
      "email,$where,attributes.secret,valid_key",
    );
    expect(projection).toContain("email");
    expect(projection).toContain("attributes.valid_key");
    expect(projection).not.toContain("$where");
    expect(projection).not.toContain("attributes.secret");
  });

  test("search escapes regex syntax while retaining multiword AND semantics", () => {
    const single = buildIdentityTextSearchFilter("a+b");
    expect(single.$or[0].displayName.$regex).toBe("a\\+b");

    const multi = buildIdentityTextSearchFilter("aarav adams");
    expect(multi.$and).toHaveLength(2);
    expect(multi.$and[0].$or.length).toBeGreaterThan(10);
  });
});
