import * as certificationReminder from "./certificationReminder.js";

/**
 * Escalation reminder email — reuses reminder template with escalation subject prefix.
 * @returns {Promise<{ subject: string, html: string }>}
 */
export async function render(payload) {
  const { subject, html } = await certificationReminder.render(payload);
  return {
    subject: subject.startsWith("[Escalation]")
      ? subject
      : `[Escalation] ${subject}`,
    html,
  };
}
