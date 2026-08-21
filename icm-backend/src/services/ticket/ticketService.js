import { getProvider } from "./providers/index.js";

/**
 * Thin façade over the ticket provider registry. Workflow step handlers call
 * these functions; the provider name (default "internal") decides where the
 * ticket actually lives. This keeps Create/Get/Update/Close Ticket steps stable
 * as external providers are added later.
 */
export async function createTicket({ provider, tenantId, executionId, ...input } = {}) {
  return getProvider(provider).create({ tenantId, executionId, ...input });
}

export async function getTicket({ provider, tenantId, ticketId } = {}) {
  return getProvider(provider).get({ tenantId, ticketId });
}

export async function updateTicket({ provider, tenantId, ticketId, fields } = {}) {
  return getProvider(provider).update({ tenantId, ticketId, fields });
}

export async function closeTicket({ provider, tenantId, ticketId, resolution } = {}) {
  return getProvider(provider).close({ tenantId, ticketId, resolution });
}
