import { registerStep } from "./registry.js";
import { stepHandlers } from "./handlers.js";

let registered = false;

export function ensureStepsRegistered() {
  if (registered) return;
  for (const [type, handler] of Object.entries(stepHandlers)) {
    registerStep(type, handler);
  }
  registered = true;
}

export { executeStep, getRegisteredTypes } from "./registry.js";
export { buildRunContext } from "./context.js";
