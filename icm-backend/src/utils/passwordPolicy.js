import PasswordPolicy from "../models/platform/PasswordPolicy.js";

/**
 * Loads the active password policy (default policy, or the first one found,
 * or a hardcoded minimum if none is configured yet).
 */
export async function getActivePasswordPolicy() {
  let policy = await PasswordPolicy.findOne({ isDefault: true });
  if (!policy) policy = await PasswordPolicy.findOne();
  if (!policy) {
    return {
      minLength: 8,
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
      lockoutAttempts: 5,
      lockoutDurationMinutes: 30,
    };
  }
  return policy;
}

/**
 * Validates a candidate password against the active policy.
 * @returns {Promise<string[]>} violation messages; empty array means valid.
 */
export async function validatePasswordAgainstPolicy(password) {
  const policy = await getActivePasswordPolicy();
  const violations = [];
  const pwd = String(password || "");

  if (pwd.length < policy.minLength) {
    violations.push(`Minimum length is ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(pwd)) {
    violations.push("Must contain at least one uppercase letter");
  }
  if (policy.requireNumbers && !/[0-9]/.test(pwd)) {
    violations.push("Must contain at least one number");
  }
  if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(pwd)) {
    violations.push("Must contain at least one special character");
  }
  return violations;
}
