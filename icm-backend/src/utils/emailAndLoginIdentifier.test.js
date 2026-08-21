import { describe, expect, test } from "@jest/globals";
import { isValidEmailSyntax, normalizeEmailAddress } from "./emailSyntax.js";
import { buildActiveUserLoginQuery, normalizeLoginIdentifier } from "./loginIdentifier.js";

describe("email syntax validation", () => {
  test("accepts a standard address", () => {
    expect(isValidEmailSyntax("john.smith@company.com")).toBe(true);
  });

  test("rejects missing domain and spaces", () => {
    expect(isValidEmailSyntax("john.smith")).toBe(false);
    expect(isValidEmailSyntax("john smith@company.com")).toBe(false);
    expect(isValidEmailSyntax("not-an-email")).toBe(false);
  });

  test("normalizes to lowercase trimmed", () => {
    expect(normalizeEmailAddress("  John.Smith@Company.COM  ")).toBe("john.smith@company.com");
  });
});

describe("login identifier", () => {
  test("email lookup stays email-only", () => {
    expect(buildActiveUserLoginQuery("Jane.Doe@Company.com")).toEqual({
      email: "jane.doe@company.com",
      isActive: true,
    });
  });

  test("username lookup does not use email", () => {
    expect(buildActiveUserLoginQuery("john.smith")).toEqual({
      username: "john.smith",
      isActive: true,
    });
  });

  test("empty identifier is rejected", () => {
    expect(buildActiveUserLoginQuery("   ")).toBeNull();
    expect(normalizeLoginIdentifier(" ABC ")).toBe("abc");
  });
});
