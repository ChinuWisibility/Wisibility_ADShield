/**
 * Server-only feature flag for P7 generic MOVER decision/planning spine.
 *
 * Default: false (P6 detection-only).
 * When true: MOVER may evaluate policy → actual → delta → plan and persist
 * request/plan. Still does NOT start workflow, create tasks, or invoke connectors.
 * Do not accept request/API overrides — env only.
 */

export function isGenericMoverOrchestrationEnabled(env = process.env) {
  const raw = env?.GENERIC_MOVER_ORCHESTRATION_ENABLED;
  if (raw == null || String(raw).trim() === "") return false;
  return String(raw).toLowerCase() === "true" || String(raw) === "1";
}
