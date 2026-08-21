/** Runtime step types that act as the workflow trigger (one per workflow). */
export const TRIGGER_STEP_TYPES = new Set([
  "CertificationSignedOff",
  "UncorrelatedAccountIAMDecision",
  "JoinerDetected",
]);

export const OPERATOR_STEP_TYPES = new Set([
  "CompareStrings",
  "CompareNumbers",
  "Loop",
  "VerifyDataType",
  "IamDecisionTaken",
  "CheckJoinerDecision",
  "EndSuccess",
  "EndFailure",
  "EndWaiting",
]);

export function isTriggerStepType(stepType) {
  return TRIGGER_STEP_TYPES.has(stepType);
}

export function countTriggerNodes(nodes) {
  return nodes.filter((n) => isTriggerStepType(n.data?.stepType)).length;
}

export function getNodeCategory(stepType, config) {
  if (stepType === "CatalogStub" && config?.catalogCategory) {
    return config.catalogCategory;
  }
  if (isTriggerStepType(stepType)) return "trigger";
  if (OPERATOR_STEP_TYPES.has(stepType)) return "operator";
  return "action";
}
