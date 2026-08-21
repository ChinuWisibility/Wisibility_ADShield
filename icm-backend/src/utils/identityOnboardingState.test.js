import { describe, expect, test } from "@jest/globals";
import {
  getIdentityOnboardingTokenTtlMs,
  isPortalOnboardingLoginBlocked,
  PASSWORD_STATUS,
  ONBOARDING_TOKEN_EXPIRED_MESSAGE,
} from "./identityOnboardingState.js";

describe("identity onboarding login gate", () => {
  test("blocks ONBOARDING users from normal login", () => {
    expect(
      isPortalOnboardingLoginBlocked({ passwordStatus: PASSWORD_STATUS.ONBOARDING }),
    ).toBe(true);
  });

  test("allows ACTIVE and legacy users without passwordStatus", () => {
    expect(isPortalOnboardingLoginBlocked({ passwordStatus: PASSWORD_STATUS.ACTIVE })).toBe(false);
    expect(isPortalOnboardingLoginBlocked({})).toBe(false);
    expect(isPortalOnboardingLoginBlocked(null)).toBe(false);
  });
});

describe("identity onboarding token TTL", () => {
  test("defaults to 7 days in milliseconds", () => {
    expect(getIdentityOnboardingTokenTtlMs()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getIdentityOnboardingTokenTtlMs(7)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("rejects invalid day values by falling back to 7", () => {
    expect(getIdentityOnboardingTokenTtlMs(0)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(getIdentityOnboardingTokenTtlMs(-3)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("expired message is stable for UI", () => {
    expect(ONBOARDING_TOKEN_EXPIRED_MESSAGE).toBe(
      "This password creation link has expired.",
    );
  });
});
