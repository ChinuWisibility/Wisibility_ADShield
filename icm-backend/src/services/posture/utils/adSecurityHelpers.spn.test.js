import { isMalformedSpn } from "./adSecurityHelpers.js";

describe("isMalformedSpn (aligned with test.ps1 Test-SPNFormat)", () => {
  test("accepts well-formed SPNs", () => {
    expect(isMalformedSpn("HTTP/web.wisibility.lcl")).toBe(false);
    expect(isMalformedSpn("HTTP/web.wisibility.lcl:8080")).toBe(false);
  });

  test("rejects missing slash and empty host/service", () => {
    expect(isMalformedSpn("INVALID_SPN_NO_SLASH")).toBe(true);
    expect(isMalformedSpn("/hostonly")).toBe(true);
    expect(isMalformedSpn("HOSTONLY/")).toBe(true);
  });

  test("rejects trailing colon (AD-accepted malformed seed)", () => {
    expect(isMalformedSpn("HTTP/misconfigured-spn.wisibility.lcl:")).toBe(true);
  });

  test("rejects double slash, whitespace, and illegal characters", () => {
    expect(isMalformedSpn("HTTP//bad.wisibility.lcl")).toBe(true);
    expect(isMalformedSpn("HTTP/bad host.wisibility.lcl")).toBe(true);
    expect(isMalformedSpn("HTTP/host<>.wisibility.lcl")).toBe(true);
  });
});
