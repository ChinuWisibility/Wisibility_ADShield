import { getPriorStepsInOrder } from "../config/stepConfigCatalog.js";

/** Most recent Send Email step upstream of the compare node (graph walk). */
export function findUpstreamSendEmail(nodes, edges, currentNodeId) {
  const prior = getPriorStepsInOrder(nodes, edges, currentNodeId);
  const sendEmails = prior.filter((n) => n.data?.stepType === "SendEmail");
  return sendEmails[sendEmails.length - 1] || null;
}

/** Last Send Email on canvas by vertical position (fallback when graph edges are missing). */
export function findLastSendEmailByPosition(nodes, excludeNodeId) {
  return [...nodes]
    .filter(
      (n) =>
        n.data?.stepType === "SendEmail"
        && n.id !== excludeNodeId,
    )
    .sort(
      (a, b) =>
        (b.position?.y || 0) - (a.position?.y || 0)
        || (b.position?.x || 0) - (a.position?.x || 0),
    )[0] || null;
}

export function buildEmailSentCompareConfig(sendEmailNode) {
  if (!sendEmailNode?.id) return null;
  const label = sendEmailNode.data?.label || "Send Email";
  return {
    left: `$.steps.${sendEmailNode.id}.queued`,
    right: "true",
    branchLabelTrue: "Sent",
    branchLabelFalse: "Failed",
    description: `Verify "${label}" was queued for delivery.`,
  };
}

function configsMatch(a, b) {
  if (!a || !b) return false;
  return a.left === b.left && String(a.right) === String(b.right);
}

function detectActiveScenario(config, scenarios) {
  if (!config || !scenarios?.length) return null;
  return scenarios.find((s) => configsMatch(config, s.preset)) || null;
}

/**
 * Contextual guidance for If / Compare Strings — explains what to compare
 * (email queued vs trigger decision vs verify output) based on workflow layout.
 */
export function resolveCompareStringsContext({
  nodes = [],
  edges = [],
  currentNodeId,
  triggerType,
  remediationAction,
  config = {},
  connectAfterNode = null,
}) {
  const upstreamEmail =
    connectAfterNode?.data?.stepType === "SendEmail"
      ? connectAfterNode
      : findUpstreamSendEmail(nodes, edges, currentNodeId)
        || findLastSendEmailByPosition(nodes, currentNodeId);

  const isAccessRevoke =
    triggerType === "CertificationSignedOff" || remediationAction === "ACCESS_REVOKE";

  const scenarios = [];

  if (upstreamEmail || isAccessRevoke) {
    const emailPreset = buildEmailSentCompareConfig(upstreamEmail);
    scenarios.push({
      id: "emailSent",
      label: "Email sent?",
      description: upstreamEmail
        ? `Checks whether "${upstreamEmail.data?.label || "Send Email"}" was queued successfully. First value = that step's queued output; Second value = true. Connect Sent (green) to continue, Failed (red) to retry or end failure.`
        : "Checks whether a Send Email step was queued successfully. Pick the email step's queued output as First value; set Second value to true.",
      preset: emailPreset || {
        left: "$.steps.<sendEmailStepId>.queued",
        right: "true",
        branchLabelTrue: "Sent",
        branchLabelFalse: "Failed",
      },
      recommended: Boolean(upstreamEmail),
    });
  }

  if (isAccessRevoke) {
    scenarios.push({
      id: "decisionRevoke",
      label: "Decision = Revoke",
      description:
        "Branches on the certification trigger — passes when the reviewer decision equals Revoke. Use when the workflow should only run for revoke outcomes.",
      preset: {
        left: "$.trigger.decision",
        right: "Revoke",
        branchLabelTrue: "Yes",
        branchLabelFalse: "No",
      },
    });
    scenarios.push({
      id: "accessStillPresent",
      label: "Access still present?",
      description:
        "After a provisioning verify step — branches on whether the entitlement still exists on the target system.",
      preset: {
        left: "$.steps.verify.stillPresent",
        right: "true",
        branchLabelTrue: "Still present",
        branchLabelFalse: "Removed",
      },
    });
  }

  if (triggerType === "UncorrelatedAccountIAMDecision" || remediationAction === "IAM_ORPHAN_REVIEW") {
    scenarios.push({
      id: "iamDecision",
      label: "IAM decision taken?",
      description: "Branches on the IAM portal decision recorded on the trigger (Assign, Delete, Disable, Ignore).",
      preset: {
        left: "$.trigger.iamDecision",
        right: "Assign",
        branchLabelTrue: "Assign",
        branchLabelFalse: "Other",
      },
    });
  }

  const activeScenario = detectActiveScenario(config, scenarios);
  const recommended = scenarios.find((s) => s.recommended) || scenarios[0];

  return {
    scenarios,
    activeScenario,
    upstreamEmail,
    purposeTitle: activeScenario?.label || recommended?.label || "Compare two values",
    purposeHint:
      activeScenario?.description
      || recommended?.description
      || "Branches the workflow when the First value equals the Second value. Connect each labeled handle to the next step.",
    fieldHints: {
      left: upstreamEmail
        ? `Main check: use "${upstreamEmail.data?.label || upstreamEmail.id}" → queued (${`$.steps.${upstreamEmail.id}.queued`}) to verify that email was accepted for sending.`
        : "The value to test — often a prior step output ($.steps.<stepId>.<field>) or trigger field ($.trigger.<field>).",
      right:
        "What First value must equal to take the Yes/Sent branch — usually true for email queued, or Revoke for decision checks.",
      branchLabelTrue: "Shown on the green/left connector when the comparison passes (e.g. Sent, Yes, Removed).",
      branchLabelFalse: "Shown on the red/right connector when it fails (e.g. Failed, No, Still present).",
    },
  };
}

/** Best config when user adds Compare Strings manually (drag, palette, or insert). */
export function inferCompareStringsConfigOnAdd({
  nodes = [],
  edges = [],
  triggerType,
  remediationAction,
  connectAfterNode = null,
  coachConfig = null,
}) {
  const emailNode =
    connectAfterNode?.data?.stepType === "SendEmail"
      ? connectAfterNode
      : findLastSendEmailByPosition(nodes);

  if (emailNode) {
    return buildEmailSentCompareConfig(emailNode);
  }

  if (coachConfig && coachConfig.left) return coachConfig;

  const isAccessRevoke =
    triggerType === "CertificationSignedOff" || remediationAction === "ACCESS_REVOKE";
  if (isAccessRevoke) {
    return {
      left: "$.trigger.decision",
      right: "Revoke",
      branchLabelTrue: "Yes",
      branchLabelFalse: "No",
    };
  }

  return null;
}
