import { describe, expect, test } from "@jest/globals";
import {
  buildUsernameBase,
  normalizeUsernamePart,
  usernameWithCollisionSuffix,
  isMongoDuplicateKey,
} from "./usernameGenerator.js";

describe("username generation", () => {
  test("John Smith becomes john.smith", () => {
    expect(buildUsernameBase({ firstName: "John", lastName: "Smith" })).toBe("john.smith");
  });

  test("normalizes case, spaces, and special characters", () => {
    expect(normalizeUsernamePart("  O'Brien  ")).toBe("obrien");
    expect(buildUsernameBase({ firstName: "Mary Jane", lastName: "O'Neil!" })).toBe("maryjane.oneil");
  });

  test("missing last name uses first name only", () => {
    expect(buildUsernameBase({ firstName: "John", lastName: "" })).toBe("john");
  });

  test("falls back to display name", () => {
    expect(buildUsernameBase({ displayName: "John Smith" })).toBe("john.smith");
  });

  test("collision suffixes match john.smith, john.smith2, john.smith3", () => {
    expect(usernameWithCollisionSuffix("john.smith", 0)).toBe("john.smith");
    expect(usernameWithCollisionSuffix("john.smith", 1)).toBe("john.smith2");
    expect(usernameWithCollisionSuffix("john.smith", 2)).toBe("john.smith3");
  });

  test("detects Mongo duplicate-key errors for username", () => {
    expect(
      isMongoDuplicateKey(
        { code: 11000, keyPattern: { username: 1 }, keyValue: { username: "john.smith" } },
        "username",
      ),
    ).toBe(true);
    expect(
      isMongoDuplicateKey(
        { code: 11000, keyPattern: { email: 1 } },
        "username",
      ),
    ).toBe(false);
  });
});
