export const PASSWORD_STATUS = {
  ACTIVE: "ACTIVE",
  ONBOARDING: "ONBOARDING",
};

export function isPortalOnboardingLoginBlocked(user) {
  return String(user?.passwordStatus || PASSWORD_STATUS.ACTIVE) === PASSWORD_STATUS.ONBOARDING;
}

export function getIdentityOnboardingTokenTtlMs(ttlDays = 7) {
  const days = Number(ttlDays);
  const safeDays = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 7;
  return safeDays * 24 * 60 * 60 * 1000;
}

export const ONBOARDING_LOGIN_BLOCKED_MESSAGE =
  "This account cannot sign in until you create your own password using the link in your welcome email.";

export const ONBOARDING_TOKEN_EXPIRED_MESSAGE =
  "This password creation link has expired.";
