import nodemailer from "nodemailer";

/**
 * Env-driven SMTP provider (Gmail, Microsoft 365, custom relays, etc.).
 * Not hardcoded to Gmail — uses EMAIL_HOST / EMAIL_PORT / EMAIL_USER / EMAIL_PASS.
 */
export default class SmtpProvider {
  constructor() {
    this._transporter = null;
    this._authKey = null;
  }

  getTransporter() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
      throw new Error(
        "EMAIL_USER and EMAIL_PASS must be configured to send email",
      );
    }

    const host = process.env.EMAIL_HOST;
    if (!host) {
      throw new Error("EMAIL_HOST must be configured (e.g. smtp.gmail.com or your corporate SMTP)");
    }

    const authKey = `${host}\0${user}\0${pass}\0${process.env.EMAIL_PORT || "465"}`;
    if (this._transporter && this._authKey === authKey) {
      return this._transporter;
    }

    const port = Number(process.env.EMAIL_PORT || 465);
    const secure =
      String(process.env.EMAIL_SECURE || "").toLowerCase() === "true" || port === 465;

    this._authKey = authKey;
    this._transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    return this._transporter;
  }

  async send({ to, subject, html, attachments = [] }) {
    const transporter = this.getTransporter();
    const fromUser = process.env.WORKFLOW_FROM_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const fromName =
      process.env.EMAIL_FROM_NAME ||
      process.env.WORKFLOW_FROM_NAME ||
      "Wisibility IGA";

    return transporter.sendMail({
      from: `"${fromName}" <${fromUser}>`,
      to,
      subject,
      html,
      attachments,
    });
  }
}

/** @deprecated Use SmtpProvider — kept for existing imports. */
export { SmtpProvider as GmailProvider };
