import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "workflow-catalog.json");

export function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
}

export function getIscPaletteCatalog() {
  const { triggers, actions, operators } = loadCatalog();
  return { triggers, actions, operators };
}

export function getImplementedStepCatalog() {
  const seen = new Set();
  const pick = (items) =>
    items.filter((i) => {
      if (!i.type || !i.implemented || seen.has(i.type)) return false;
      seen.add(i.type);
      return true;
    });
  const { triggers, actions, operators } = loadCatalog();
  return {
    triggers: pick(triggers),
    actions: pick(actions),
    operators: pick(operators),
  };
}

/** True when a catalog item is usable for the given remediation action. */
function matchesRemediationAction(item, remediationAction) {
  if (!remediationAction) return true;
  const scope = item.remediationScope;
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.includes("SHARED") || scope.includes(remediationAction);
}

/**
 * Implemented catalog scoped to a remediation action (ACCESS_REVOKE / IAM_ORPHAN_REVIEW).
 * Unique per label (not per type) so both "Manage Access" and "Revoke Access" surface.
 * Adds `paletteGroup` metadata for the grouped builder palette.
 */
export function getRemediationStepCatalog(remediationAction) {
  const keep = (items) =>
    items.filter(
      (i) => i.type && i.implemented && matchesRemediationAction(i, remediationAction),
    );
  const { triggers, actions, operators } = loadCatalog();
  return {
    triggers: keep(triggers),
    actions: keep(actions),
    operators: keep(operators),
  };
}

export const TRIGGER_STEP_TYPES = new Set(
  loadCatalog()
    .triggers.filter((t) => t.implemented && t.type)
    .map((t) => t.type),
);

export function getImplementedTypes() {
  const types = new Set(["CatalogStub"]);
  const cat = loadCatalog();
  for (const group of [cat.triggers, cat.actions, cat.operators]) {
    for (const item of group) {
      if (item.implemented && item.type) types.add(item.type);
    }
  }
  return types;
}

export const TERMINAL_STEP_TYPES = new Set(["EndSuccess", "EndFailure", "EndWaiting"]);

/** Fixed trigger type → remediation action (queue action) the workflow serves. */
export const TRIGGER_REMEDIATION_ACTION = {
  CertificationSignedOff: "ACCESS_REVOKE",
  UncorrelatedAccountIAMDecision: "IAM_ORPHAN_REVIEW",
  JoinerDetected: "JOINER",
};

/** Merged map of step type → remediation scopes (union across catalog labels). */
export function getStepScopeMap() {
  const map = {};
  const cat = loadCatalog();
  for (const group of [cat.triggers, cat.actions, cat.operators]) {
    for (const item of group) {
      if (!item.type || !item.implemented) continue;
      const scope = Array.isArray(item.remediationScope) ? item.remediationScope : [];
      map[item.type] = Array.from(new Set([...(map[item.type] || []), ...scope]));
    }
  }
  return map;
}

export const BRANCHING_STEP_TYPES = new Set([
  "CompareStrings",
  "CompareNumbers",
  "VerifyDataType",
  "IamDecisionTaken",
  "SchedulerCheck",
  "CheckJoinerDecision",
]);
