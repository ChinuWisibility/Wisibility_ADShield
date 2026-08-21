/**
 * Server-only feature flag for P5 generic Joiner cutover.
 *
 * Default: false (legacy Joiner path).
 * Do not accept request/API overrides — env only.
 */

export function isGenericJmlOrchestrationEnabled(
  env = process.env,
) {
  const raw = env?.GENERIC_JML_ORCHESTRATION_ENABLED;
  if (raw == null || String(raw).trim() === "") return false;
  return String(raw).toLowerCase() === "true" || String(raw) === "1";
}
