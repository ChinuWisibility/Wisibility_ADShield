const PATH_LABELS = {
  "$.trigger.identityEmail": "User email from trigger",
  "$.trigger.managerEmail": "Manager email from trigger",
  "$.trigger.managerName": "Manager name from trigger",
  "$.trigger.identityName": "User name from trigger",
  "$.trigger.entitlementName": "Entitlement from trigger",
  "$.trigger.applicationName": "Application from trigger",
  "$.trigger.campaignName": "Campaign from trigger",
  "$.trigger.reviewerName": "Reviewer from trigger",
  "$.config.iamTeamEmail": "IAM team email",
  "$.config.workflowFromEmail": "Workflow sender email",
};

export function humanizeVariablePath(path) {
  if (!path || typeof path !== "string") return "Not set";
  const trimmed = path.trim();
  if (PATH_LABELS[trimmed]) return PATH_LABELS[trimmed];
  if (trimmed.startsWith("$.steps.")) {
    const rest = trimmed.replace("$.steps.", "").replace(/\./g, " · ");
    return `From step: ${rest}`;
  }
  if (trimmed.startsWith("$.trigger.")) {
    return `From trigger: ${trimmed.replace("$.trigger.", "").replace(/([A-Z])/g, " $1").trim()}`;
  }
  return trimmed;
}
