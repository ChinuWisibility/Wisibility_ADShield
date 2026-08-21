import { describe, expect, test } from "@jest/globals";
import {
  escapeLdapDnValue,
  escapeLdapFilterValue,
  buildCnDn,
} from "./ldapDn.js";

describe("ldapDn escaping", () => {
  test("normal CN", () => {
    expect(escapeLdapDnValue("John Doe")).toBe("John Doe");
    expect(buildCnDn("John Doe", "OU=Users,DC=ex,DC=com")).toBe(
      "CN=John Doe,OU=Users,DC=ex,DC=com",
    );
  });

  test("comma in name", () => {
    expect(escapeLdapDnValue("Doe, John")).toBe("Doe\\, John");
  });

  test("plus sign", () => {
    expect(escapeLdapDnValue("A+B")).toBe("A\\+B");
  });

  test("quote", () => {
    expect(escapeLdapDnValue('Say "Hi"')).toBe('Say \\"Hi\\"');
  });

  test("backslash", () => {
    expect(escapeLdapDnValue("a\\b")).toBe("a\\\\b");
  });

  test("hash", () => {
    expect(escapeLdapDnValue("#root")).toBe("\\#root");
  });

  test("equals", () => {
    expect(escapeLdapDnValue("a=b")).toBe("a\\=b");
  });

  test("angle brackets and semicolon", () => {
    expect(escapeLdapDnValue("a<b>;c")).toBe("a\\<b\\>\\;c");
  });

  test("filter escaping", () => {
    expect(escapeLdapFilterValue("a*(b)\\")).toBe("a\\2a\\28b\\29\\5c");
  });
});
