/**
 * In-memory adapter for builder TEST runs only. Uses the trigger payload you
 * provide — no canned identities. Side effects are collected via dump() for
 * the test panel; live certification runs use igaAdapter instead.
 */
import { checkDemoEntitlement } from "../verification/checkEntitlement.js";

export function createDemoAdapter(triggerInput) {
  const t = triggerInput?.trigger || triggerInput || {};
  const identities = {};

  if (t.identityId) {
    const access = [];
    const includeAccess =
      !t.simulateAccessRemoved && (t.entitlementId || t.entitlementName);
    if (includeAccess) {
      access.push({ entitlementId: t.entitlementId, entitlementName: t.entitlementName });
    }
    identities[t.identityId] = {
      id: t.identityId,
      name: t.identityName || t.identityId,
      displayName: t.identityName || t.identityId,
      email: t.identityEmail || "",
      managerEmail: t.managerEmail || "",
      managerName: t.managerName || "",
      access,
    };
  }

  const outbox = [];
  const tickets = [];
  const audits = [];

  return {
    getIdentity(identityId) {
      return identities[identityId] || null;
    },

    hasEntitlement(identityId, { entitlementId, entitlementName } = {}) {
      return checkDemoEntitlement(identities, identityId, { entitlementId, entitlementName });
    },

    revokeEntitlement(identityId, { entitlementId, entitlementName } = {}) {
      const identity = identities[identityId];
      if (!identity) return { success: false, error: "Identity not found" };
      const before = identity.access.length;
      identity.access = identity.access.filter(
        (a) =>
          !(
            (entitlementId && a.entitlementId === entitlementId) ||
            (entitlementName && a.entitlementName === entitlementName)
          ),
      );
      const removed = before - identity.access.length;
      return {
        success: removed > 0,
        removedCount: removed,
        remainingAccess: identity.access.map((a) => a.entitlementName),
      };
    },

    addEmail(email) {
      const entry = {
        id: `email-${Date.now()}-${outbox.length}`,
        sentAt: new Date().toISOString(),
        to: email.to,
        from: email.from,
        subject: email.subject,
        body: email.body,
        label: email.label,
      };
      outbox.push(entry);
      return entry;
    },

    addTicket(ticket) {
      const entry = {
        id: `ticket-${Date.now()}-${tickets.length}`,
        createdAt: new Date().toISOString(),
        status: "OPEN",
        ...ticket,
      };
      tickets.push(entry);
      return entry;
    },

    addAudit(entry) {
      const row = {
        id: `audit-${Date.now()}-${audits.length}`,
        at: new Date().toISOString(),
        ...entry,
      };
      audits.push(row);
      return row;
    },

    updateOrphanWorkflowStatus(_orphanId, _fields) {
      return { updated: true };
    },

    getOrphanDecision(_orphanId) {
      return { iamDecision: "ASSIGN", workflowStatus: "WAITING_IAM" };
    },

    dump() {
      return { outbox: [...outbox], tickets: [...tickets], audits: [...audits] };
    },
  };
}

/** @deprecated alias */
export const createSandboxAdapter = createDemoAdapter;
