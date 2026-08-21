import { wrapBrandedEmail } from "../emailLayout.js";

function renderContent({ safeName, resetUrl, expiresInMinutes }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td>
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;">Hi ${safeName} 👋</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">We received a request to reset your password</p>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px;">
  <tr><td style="background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);border-left:4px solid #3b82f6;border-radius:12px;padding:20px 24px;">
    <p style="margin:0 0 8px;font-size:14px;color:#0f172a;font-weight:600;">🔐 Password Reset Request</p>
    <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">A request has been made to reset the password for your account. Click the button below to create a new password.</p>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px;">
  <tr><td align="center">
    <a href="${resetUrl}" style="display:inline-block;padding:16px 48px;background:#2563eb;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Reset Your Password →</a>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">This link expires in <strong style="color:#64748b;">${expiresInMinutes} minutes</strong></p>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px;">
  <tr><td style="background-color:#f8fafc;border-radius:12px;padding:20px 24px;">
    <p style="margin:0 0 12px;font-size:13px;color:#475569;font-weight:600;">Button not working?</p>
    <p style="margin:0 0 12px;font-size:13px;color:#64748b;line-height:1.6;">Copy and paste this link into your browser:</p>
    <div style="padding:12px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;word-break:break-all;">
      <a href="${resetUrl}" style="color:#3b82f6;font-size:12px;text-decoration:none;">${resetUrl}</a>
    </div>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td style="background-color:#fef2f2;border-left:3px solid #ef4444;border-radius:8px;padding:16px 20px;">
    <p style="margin:0 0 6px;font-size:13px;color:#991b1b;font-weight:600;">Didn't request this?</p>
    <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.6;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
  </td></tr>
</table>`;
}

export async function render({
  recipientName,
  resetUrl,
  expiresInMinutes = 60,
}) {
  const safeName = recipientName || "there";
  const content = renderContent({ safeName, resetUrl, expiresInMinutes });
  return {
    subject: "Reset your password",
    html: await wrapBrandedEmail(content, { subtitle: "Password reset requested" }),
  };
}
