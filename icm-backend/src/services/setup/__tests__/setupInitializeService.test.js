import path from "path";
import {
  splitAdminName,
  validatePasswordAgainstPolicy,
  resolveTrustedLicensePath,
} from "../setupInitializeService.js";

describe("setupInitializeService helpers", () => {
  test("splitAdminName handles single and multi-word names", () => {
    expect(splitAdminName("Jane")).toEqual({ firstName: "Jane", lastName: "Admin" });
    expect(splitAdminName("Jane Doe")).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(splitAdminName("  Jane  Marie  Doe ")).toEqual({
      firstName: "Jane",
      lastName: "Marie Doe",
    });
  });

  test("validatePasswordAgainstPolicy enforces defaults", () => {
    expect(validatePasswordAgainstPolicy("short")).toEqual(
      expect.arrayContaining([expect.stringMatching(/Minimum length/i)]),
    );
    expect(validatePasswordAgainstPolicy("alllowercase1!")).toEqual(
      expect.arrayContaining([expect.stringMatching(/uppercase/i)]),
    );
    expect(validatePasswordAgainstPolicy("ALLUPPERCASE1!")).toEqual(
      expect.arrayContaining([expect.stringMatching(/lowercase/i)]),
    );
    expect(validatePasswordAgainstPolicy("NoSpecials12")).toEqual(
      expect.arrayContaining([expect.stringMatching(/special/i)]),
    );
    expect(validatePasswordAgainstPolicy("GoodPassw0rd!")).toEqual([]);
  });

  test("resolveTrustedLicensePath rejects paths outside license dir", async () => {
    const { default: env } = await import("../../../config/env.js");
    const prev = env.paths.data;
    env.paths.data = path.join("C:", "ProgramData", "ADSecurity");
    try {
      expect(() =>
        resolveTrustedLicensePath(path.join("C:", "Temp", "evil.lic.json")),
      ).toThrow(/license directory/i);
      const ok = resolveTrustedLicensePath(
        path.join(env.paths.data, "license", "license.lic.json"),
      );
      expect(ok.toLowerCase()).toContain("license");
    } finally {
      env.paths.data = prev;
    }
  });
});
