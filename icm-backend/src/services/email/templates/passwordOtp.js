import { wrapBrandedEmail } from "../emailLayout.js";

function renderContent({ safeName, otpCode, expiresInMinutes }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#0f172a;">Forgot your password?</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${safeName}, use the verification code below to reset your password.</p>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td align="center" style="padding:0 0 32px;">
    <div style="display:inline-block;padding:20px 48px;background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;font-size:36px;font-weight:800;letter-spacing:0.25em;font-family:monospace;color:#0f172a;">${otpCode}</div>
    <p style="margin:16px 0 0;font-size:13px;color:#64748b;line-height:1.6;">This code expires in <strong style="color:#0f172a;">${expiresInMinutes} minutes</strong>.</p>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td style="background-color:#fef2f2;border-left:3px solid #ef4444;border-radius:8px;padding:16px 20px;">
    <p style="margin:0 0 6px;font-size:13px;color:#991b1b;font-weight:600;">Didn't request this?</p>
    <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.6;">If you didn't request a password reset, please ignore this email or contact your administrator immediately.</p>
  </td></tr>
</table>`;
}

export async function render({
  recipientName,
  otpCode,
  expiresInMinutes = 10,
}) {
  const safeName = recipientName || "there";
  const content = renderContent({ safeName, otpCode, expiresInMinutes });
  return {
    subject: "Your password reset code",
    html: await wrapBrandedEmail(content, {
      subtitle: "Password reset verification code",
    }),
  };
}
