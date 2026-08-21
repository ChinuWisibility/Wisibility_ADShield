import { describe, expect, it } from "@jest/globals";
import { getIdentityValueByTargetKey } from "./identityMappedValues.js";

describe("identityMappedValues displayName", () => {
  it("reads top-level displayName when column targetKey is DISPLAYNAME", () => {
    const identity = {
      displayName: "Rohan Smith",
      email: "rohan.smith@wisibility.lcl",
    };
    expect(getIdentityValueByTargetKey(identity, "DISPLAYNAME")).toBe("Rohan Smith");
    expect(getIdentityValueByTargetKey(identity, "displayName")).toBe("Rohan Smith");
  });

  it("falls back to first + last when displayName is empty", () => {
    const identity = {
      firstName: "Rohan",
      lastName: "Smith",
      email: "rohan.smith@wisibility.lcl",
    };
    expect(getIdentityValueByTargetKey(identity, "displayname")).toBe("Rohan Smith");
  });
});
