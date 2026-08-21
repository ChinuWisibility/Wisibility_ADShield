import { TICKET_PROVIDERS } from "../../../models/ticket/WorkflowTicket.js";
import { internalProvider } from "./internalProvider.js";

/**
 * Provider registry. Only Internal ships today; ServiceNow/Jira/REST/Email are
 * registered here as they are implemented, with no change to the workflow JSON
 * or step handlers (the action config just picks a different provider name).
 */
const PROVIDERS = {
  [TICKET_PROVIDERS.INTERNAL]: internalProvider,
};

export function getProvider(name) {
  const key = String(name || TICKET_PROVIDERS.INTERNAL).toLowerCase();
  return PROVIDERS[key] || PROVIDERS[TICKET_PROVIDERS.INTERNAL];
}

export function isProviderImplemented(name) {
  const key = String(name || "").toLowerCase();
  return Boolean(PROVIDERS[key]);
}
