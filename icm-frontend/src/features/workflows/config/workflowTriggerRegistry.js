/**
 * Single source of truth for supported remediation workflow triggers.
 * Add a new entry here (+ backend catalog scope) to enable another trigger.
 */

import { v4 as uuidv4 } from "../utils/uuid.js";
import { getDefaultConfig } from "./stepConfigCatalog.js";
import { buildEdgeFromConnection } from "../utils/workflowConstraints.js";
import { findTriggerNode, WORKFLOW_NODE_H } from "../utils/workflowNodeVisuals.js";
import { getPresetConfig } from "../utils/workflowStepConfig.js";

const Y_GAP = WORKFLOW_NODE_H + 28;
const BRANCH_X_OFFSET = 220;

function makeNodeId(prefix) {
  return `${prefix}-${uuidv4().slice(0, 6)}`;
}

const ACCESS_REVOKE_COACH_STEPS = [
  {
    id: "ticket",
    stepType: "CreateTicket",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "ticket",
    paletteLabel: "Create Ticket",
    shortLabel: "Create Ticket",
    presetId: "accessRevokePopulate",
  },
  {
    id: "emailUser",
    stepType: "SendEmail",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "notifications",
    paletteLabel: "Send Email",
    shortLabel: "Notify User",
    presetId: "userRevoked",
    configPatch: { includeReviewPortal: false },
  },
  {
    id: "emailManager",
    stepType: "SendEmail",
    matchIndex: 1,
    paletteTab: "action",
    paletteGroup: "notifications",
    paletteLabel: "Send Email",
    shortLabel: "Notify Manager",
    presetId: "managerNotify",
    configPatch: { includeReviewPortal: false },
  },
  {
    id: "emailCheck",
    stepType: "CompareStrings",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "flow",
    paletteLabel: "If / Compare Strings",
    shortLabel: "Email sent?",
    configResolver(nodes) {
      const emails = nodes.filter((n) => n.data?.stepType === "SendEmail");
      const stepRef = emails[0]?.id || "emailUser";
      return {
        left: `$.steps.${stepRef}.queued`,
        right: "true",
        branchLabelTrue: "Sent",
        branchLabelFalse: "Failed",
      };
    },
  },
  {
    id: "completeQueue",
    stepType: "UpdateQueueTask",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "queue",
    paletteLabel: "Update Queue Task",
    shortLabel: "Complete Queue Task",
    configPatch: { status: "COMPLETED", description: "Access revoke notifications sent." },
    connectAfterStepType: "CompareStrings",
    connectBranch: "true",
  },
  {
    id: "endSuccess",
    stepType: "EndSuccess",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "flow",
    paletteLabel: "End Step — Success",
    shortLabel: "End Success",
    config: {},
  },
  {
    id: "endFailure",
    stepType: "EndFailure",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "flow",
    paletteLabel: "End Step — Failure",
    shortLabel: "End Failure",
    config: {},
    connectAfterStepType: "CompareStrings",
    connectBranch: "false",
  },
];

const IAM_ORPHAN_COACH_STEPS = [
  {
    id: "context",
    stepType: "GetOrphanContext",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "process",
    paletteLabel: "Get Orphan Context",
    shortLabel: "Get Orphan Context",
    config: {},
  },
  {
    id: "reminders",
    stepType: "OrphanReminderSchedule",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "process",
    paletteLabel: "Orphan Reminder Schedule",
    shortLabel: "Reminder Schedule",
    config: { reminderPhases: "1h,3h,6h,12h" },
  },
  {
    id: "email",
    stepType: "SendEmail",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "notifications",
    paletteLabel: "Send Email",
    shortLabel: "Send Action Email",
    presetId: "iamOrphanReview",
    configPatch: { includeReviewPortal: true },
  },
  {
    id: "wait",
    stepType: "WaitForIAMDecision",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "process",
    paletteLabel: "Wait for Portal Decision",
    shortLabel: "Wait for Portal Decision",
    config: {},
  },
  {
    id: "completeQueue",
    stepType: "UpdateQueueTask",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "queue",
    paletteLabel: "Update Queue Task",
    shortLabel: "Complete Queue Task",
    configPatch: { status: "COMPLETED", description: "IAM orphan decision recorded." },
  },
  {
    id: "endSuccess",
    stepType: "EndSuccess",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "flow",
    paletteLabel: "End Step — Success",
    shortLabel: "End Success",
    config: {},
  },
];

function buildAccessRevokeAutoFlow(nodes, edges) {
  const trigger = findTriggerNode(nodes);
  if (!trigger) return { error: "Add a trigger first." };

  const ids = {};
  const baseX = trigger.position?.x ?? 320;
  let y = (trigger.position?.y ?? 40) + Y_GAP;

  const specs = [
    { key: "ticket", stepType: "CreateTicket", label: "Create Ticket", paletteLabel: "Create Ticket", presetId: "accessRevokePopulate" },
    { key: "emailUser", stepType: "SendEmail", label: "Notify User", paletteLabel: "Send Email", presetId: "userRevoked", configPatch: { includeReviewPortal: false } },
    { key: "emailManager", stepType: "SendEmail", label: "Notify Manager", paletteLabel: "Send Email", presetId: "managerNotify", configPatch: { includeReviewPortal: false } },
    {
      key: "emailCheck",
      stepType: "CompareStrings",
      label: "Email Sent?",
      paletteLabel: "If / Compare Strings",
      config: () => ({
        left: `$.steps.${ids.emailUser}.queued`,
        right: "true",
        branchLabelTrue: "Sent",
        branchLabelFalse: "Failed",
      }),
    },
    { key: "completeQueue", stepType: "UpdateQueueTask", label: "Complete Queue Task", paletteLabel: "Update Queue Task", config: { status: "COMPLETED", description: "Access revoke notifications sent." } },
    { key: "endSuccess", stepType: "EndSuccess", label: "End — Success", paletteLabel: "End Step — Success", config: {} },
    { key: "endFailure", stepType: "EndFailure", label: "End — Failure", paletteLabel: "End Step — Failure", config: {}, branchOffset: true },
  ];

  const newNodes = [];
  const newEdges = [];
  let prevId = trigger.id;

  for (const spec of specs) {
    const id = makeNodeId(spec.stepType.replace(/[^a-zA-Z]/g, "").toLowerCase());
    ids[spec.key] = id;

    let config = spec.presetId ? getPresetConfig(spec.stepType, spec.presetId) : getDefaultConfig(spec.stepType);
    if (typeof spec.config === "function") config = { ...config, ...spec.config() };
    else if (spec.config) config = { ...config, ...spec.config };
    if (spec.configPatch) config = { ...config, ...spec.configPatch };

    const x = spec.branchOffset ? baseX + BRANCH_X_OFFSET : baseX;
    newNodes.push({
      id,
      type: "workflowStep",
      position: { x, y },
      data: {
        label: spec.label,
        stepType: spec.stepType,
        config,
        paletteLabel: spec.paletteLabel,
      },
    });

    if (spec.key === "endFailure") {
      newEdges.push(buildEdgeFromConnection({ source: ids.emailCheck, target: id, sourceHandle: "false" }, [...nodes, ...newNodes]));
    } else if (spec.key === "completeQueue") {
      newEdges.push(buildEdgeFromConnection({ source: ids.emailCheck, target: id, sourceHandle: "true" }, [...nodes, ...newNodes]));
      prevId = id;
    } else {
      newEdges.push(buildEdgeFromConnection({ source: prevId, target: id }, [...nodes, ...newNodes]));
      prevId = id;
      if (!spec.branchOffset) y += Y_GAP;
    }
  }

  return { nodes: [...nodes, ...newNodes], edges: [...edges, ...newEdges] };
}

function buildIamOrphanAutoFlow(nodes, edges) {
  const trigger = findTriggerNode(nodes);
  if (!trigger) return { error: "Add a trigger first." };

  const baseX = trigger.position?.x ?? 320;
  let y = (trigger.position?.y ?? 40) + Y_GAP;
  let prevId = trigger.id;
  const newNodes = [];
  const newEdges = [];

  const linearSpecs = [
    { stepType: "GetOrphanContext", label: "Get Orphan Context", config: {} },
    { stepType: "OrphanReminderSchedule", label: "Orphan Reminder Schedule", config: { reminderPhases: "1h,3h,6h,12h" } },
    { stepType: "SendEmail", label: "Send Action Email", presetId: "iamOrphanReview", configPatch: { includeReviewPortal: true } },
    { stepType: "WaitForIAMDecision", label: "Wait for Portal Decision", config: {} },
    { stepType: "UpdateQueueTask", label: "Complete Queue Task", config: { status: "COMPLETED", description: "IAM orphan decision recorded." } },
    { stepType: "EndSuccess", label: "End — Success", config: {} },
  ];

  for (const spec of linearSpecs) {
    const id = makeNodeId(spec.stepType.replace(/[^a-zA-Z]/g, "").toLowerCase());
    let config = spec.presetId ? getPresetConfig(spec.stepType, spec.presetId) : getDefaultConfig(spec.stepType);
    if (spec.config) config = { ...config, ...spec.config };
    if (spec.configPatch) config = { ...config, ...spec.configPatch };

    newNodes.push({
      id,
      type: "workflowStep",
      position: { x: baseX, y },
      data: { label: spec.label, stepType: spec.stepType, config },
    });
    newEdges.push(buildEdgeFromConnection({ source: prevId, target: id }, [...nodes, ...newNodes]));
    prevId = id;
    y += Y_GAP;
  }

  return { nodes: [...nodes, ...newNodes], edges: [...edges, ...newEdges] };
}

const JOINER_COACH_STEPS = [
  {
    id: "waitApproval",
    stepType: "WaitForJoinerApproval",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "process",
    paletteLabel: "Wait for Joiner Approval",
    shortLabel: "Await Approval",
    config: { checkpointNodeId: "checkDecision" },
  },
  {
    id: "checkDecision",
    stepType: "CheckJoinerDecision",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "process",
    paletteLabel: "Check Joiner Decision",
    shortLabel: "Approved?",
    config: {
      branchLabelTrue: "Approved",
      branchLabelFalse: "Rejected",
    },
  },
  {
    id: "provision",
    stepType: "ProvisionJoinerAccount",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "process",
    paletteLabel: "Provision Joiner Account",
    shortLabel: "Compile Plan",
    config: {},
    connectAfterStepType: "CheckJoinerDecision",
    connectBranch: "true",
  },
  {
    id: "reject",
    stepType: "RejectJoinerRequest",
    matchIndex: 0,
    paletteTab: "action",
    paletteGroup: "process",
    paletteLabel: "Reject Joiner Request",
    shortLabel: "Reject",
    config: {},
    connectAfterStepType: "CheckJoinerDecision",
    connectBranch: "false",
  },
  {
    id: "endSuccess",
    stepType: "EndSuccess",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "flow",
    paletteLabel: "End Step — Success",
    shortLabel: "End Success",
    config: {},
    connectAfterStepType: "ProvisionJoinerAccount",
  },
  {
    id: "endFailure",
    stepType: "EndFailure",
    matchIndex: 0,
    paletteTab: "operator",
    paletteGroup: "flow",
    paletteLabel: "End Step — Failure",
    shortLabel: "End Failure",
    config: {},
    connectAfterStepType: "RejectJoinerRequest",
  },
];

function buildJoinerAutoFlow(nodes, edges) {
  const trigger = findTriggerNode(nodes);
  if (!trigger) return { error: "Add a trigger first." };

  const baseX = trigger.position?.x ?? 280;
  let y = (trigger.position?.y ?? 0) + Y_GAP;
  const newNodes = [];
  const newEdges = [];
  const ids = {};

  const addNode = (key, stepType, label, config, x) => {
    const id = key === "checkDecision" ? "checkDecision" : makeNodeId(key);
    ids[key] = id;
    newNodes.push({
      id,
      type: "workflowStep",
      position: { x, y },
      data: {
        label,
        stepType,
        config: { ...getDefaultConfig(stepType), ...config },
      },
    });
  };

  addNode(
    "waitApproval",
    "WaitForJoinerApproval",
    "Await Joiner Approval",
    { checkpointNodeId: "checkDecision" },
    baseX,
  );
  y += Y_GAP;
  addNode(
    "checkDecision",
    "CheckJoinerDecision",
    "Approved?",
    { branchLabelTrue: "Approved", branchLabelFalse: "Rejected" },
    baseX,
  );
  y += Y_GAP;
  addNode("provision", "ProvisionJoinerAccount", "Compile Plan + ADD_ACCOUNT Task", {}, baseX - BRANCH_X_OFFSET / 2);
  addNode("reject", "RejectJoinerRequest", "Reject Joiner Request", {}, baseX + BRANCH_X_OFFSET / 2);
  y += Y_GAP;
  addNode("endOk", "EndSuccess", "End Success", {}, baseX - BRANCH_X_OFFSET / 2);
  addNode("endFail", "EndFailure", "End Failure", {}, baseX + BRANCH_X_OFFSET / 2);

  const all = [...nodes, ...newNodes];
  newEdges.push(buildEdgeFromConnection({ source: trigger.id, target: ids.waitApproval }, all));
  newEdges.push(buildEdgeFromConnection({ source: ids.waitApproval, target: ids.checkDecision }, all));
  newEdges.push(
    buildEdgeFromConnection(
      { source: ids.checkDecision, target: ids.provision, sourceHandle: "true" },
      all,
    ),
  );
  newEdges.push(
    buildEdgeFromConnection(
      { source: ids.checkDecision, target: ids.reject, sourceHandle: "false" },
      all,
    ),
  );
  newEdges.push(buildEdgeFromConnection({ source: ids.provision, target: ids.endOk }, all));
  newEdges.push(buildEdgeFromConnection({ source: ids.reject, target: ids.endFail }, all));

  return { nodes: [...nodes, ...newNodes], edges: [...edges, ...newEdges] };
}

/** @type {Record<string, object>} */
export const WORKFLOW_TRIGGER_REGISTRY = {
  CertificationSignedOff: {
    triggerType: "CertificationSignedOff",
    remediationAction: "ACCESS_REVOKE",
    enabled: true,
    eventMeta: {
      action: "ACCESS_REVOKE",
      title: "Access Revoke",
      badge: "ACCESS REVOKE",
      accent: "green",
      triggerType: "CertificationSignedOff",
      triggerLabel: "Certification Signed Off",
      tag: "CERTIFICATION_REVOKE",
      description:
        "Manager revokes access in certification → queue task → this workflow runs. Create a ticket, notify the user and manager, then complete the queue task.",
    },
    coachPath: {
      id: "access-revoke-mvp",
      label: "Access Revoke MVP",
      finishHint: "Save → Validate → map in Global Rule Set → Access Revoke.",
      steps: ACCESS_REVOKE_COACH_STEPS,
    },
    autoFlow: {
      title: "Access Revoke MVP",
      description: "Ticket, user & manager email, verify sent, complete queue — ready to save.",
      finishHint: "Save → Validate → Global Rule Set → Access Revoke → pick this workflow → Save.",
      build: buildAccessRevokeAutoFlow,
    },
    templates: [
      { id: "mvp-auto", label: "Recommended MVP", kind: "autoBuild", recommended: true },
      { id: "dual-notify", label: "Dual notify + close ticket", kind: "seed", seedKey: "accessRevokeDualNotify" },
      { id: "option2", label: "Automated Option 2", kind: "seed", seedKey: "accessRevokeOption2" },
    ],
  },
  UncorrelatedAccountIAMDecision: {
    triggerType: "UncorrelatedAccountIAMDecision",
    remediationAction: "IAM_ORPHAN_REVIEW",
    enabled: true,
    eventMeta: {
      action: "IAM_ORPHAN_REVIEW",
      title: "IAM Orphan Review",
      badge: "IAM ORPHAN REVIEW",
      accent: "amber",
      triggerType: "UncorrelatedAccountIAMDecision",
      triggerLabel: "Uncorrelated Account — IAM Decision",
      tag: "IAM_ORPHAN_REVIEW",
      description:
        "Orphan account from Data Hygiene → queue → official trigger UncorrelatedAccountIAMDecision → IAM email + portal (Assign/Delete/Disable/Ignore) → audit & complete.",
    },
    coachPath: {
      id: "iam-orphan-mvp",
      label: "IAM Orphan MVP",
      finishHint: "Save → Validate → map in Global Rule Set → IAM Orphan Review.",
      steps: IAM_ORPHAN_COACH_STEPS,
    },
    autoFlow: {
      title: "IAM Orphan MVP",
      description: "Context, reminder schedule, review email with portal, wait, complete queue.",
      finishHint: "Save → Validate → Global Rule Set → IAM Orphan Review → pick this workflow → Save.",
      build: buildIamOrphanAutoFlow,
    },
    templates: [
      { id: "mvp-auto", label: "Recommended MVP", kind: "autoBuild", recommended: true },
      { id: "iam-orphan-seed", label: "Full orphan review template", kind: "seed", seedKey: "iamOrphan" },
    ],
  },
  JoinerDetected: {
    triggerType: "JoinerDetected",
    remediationAction: "JOINER",
    enabled: true,
    eventMeta: {
      action: "JOINER",
      title: "Joiner Provision",
      badge: "JOINER",
      accent: "blue",
      triggerType: "JoinerDetected",
      triggerLabel: "Joiner Detected",
      tag: "JOINER",
      description:
        "HRMS / lifecycle creates a Joiner request → approval wait → compile ADD_ACCOUNT plan/task (or reject without provisioning).",
    },
    coachPath: {
      id: "joiner-mvp",
      label: "Joiner Provision MVP",
      finishHint: "Save → Validate. Runtime prefers this tenant copy over the global template.",
      steps: JOINER_COACH_STEPS,
    },
    autoFlow: {
      title: "Joiner Provision MVP",
      description: "Await approval, branch on decision, compile ADD_ACCOUNT or reject.",
      finishHint: "Save → Validate. Lifecycle/Joiner runtime will use this tenant workflow when present.",
      build: buildJoinerAutoFlow,
    },
    templates: [
      { id: "mvp-auto", label: "Recommended MVP", kind: "autoBuild", recommended: true },
    ],
  },
};

export const SUPPORTED_TRIGGER_TYPES = Object.keys(WORKFLOW_TRIGGER_REGISTRY).filter(
  (k) => WORKFLOW_TRIGGER_REGISTRY[k].enabled,
);

export function getTriggerRegistryEntry(triggerType) {
  return WORKFLOW_TRIGGER_REGISTRY[triggerType] || null;
}

export function isSupportedTriggerType(triggerType) {
  const entry = getTriggerRegistryEntry(triggerType);
  return Boolean(entry?.enabled);
}

export function getRegistryEntryByAction(remediationAction) {
  return (
    Object.values(WORKFLOW_TRIGGER_REGISTRY).find(
      (e) => e.enabled && e.remediationAction === remediationAction,
    ) || null
  );
}

export function getAllRegistryEvents() {
  return SUPPORTED_TRIGGER_TYPES.map((t) => WORKFLOW_TRIGGER_REGISTRY[t].eventMeta);
}

export function getCoachPathForAction(remediationAction) {
  return getRegistryEntryByAction(remediationAction)?.coachPath || null;
}

export function getCoachPathForTrigger(triggerType) {
  return getTriggerRegistryEntry(triggerType)?.coachPath || null;
}

export function getAutoFlowForTrigger(triggerType) {
  return getTriggerRegistryEntry(triggerType)?.autoFlow || null;
}

export function getTemplatesForTrigger(triggerType) {
  return getTriggerRegistryEntry(triggerType)?.templates || [];
}
