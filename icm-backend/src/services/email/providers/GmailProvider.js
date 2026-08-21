/**
 * Backward-compatible export — email sending is env-driven SMTP (SmtpProvider).
 * Prefer importing SmtpProvider or getEmailProvider().
 */
export { default } from "./SmtpProvider.js";
export { default as SmtpProvider, GmailProvider } from "./SmtpProvider.js";
