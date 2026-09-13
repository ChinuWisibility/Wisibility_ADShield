import { wrapCertificationEmail } from "../../access-certification/certificationEmailTemplates.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderContent({
  safeName,
  username,
  password,
  loginUrl,
  createPasswordUrl,
  expiresInDays,
}) {
  return `
  <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.35;">Welcome to ADSecurity</div>
  <div style="margin-top:12px;font-size:15px;color:#475569;line-height:1.65;">
    Hi <strong style="color:#0f172a;">${safeName}</strong>, your ADSecurity account has been created.
  </div>
  <div style="margin-top:16px;display:inline-block;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;font-size:13px;color:#92400e;font-weight:600;">This temporary password cannot be used to log in</div>
  <div style="background:linear-gradient(180deg,#f8fafc 0%,#ffffff 100%);border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin:22px 0;text-align:center;">
    <a href="${createPasswordUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:10px;padding:14px 28px;">Create Own Password</a>
    <div style="font-size:12px;color:#64748b;line-height:1.6;margin-top:12px;">This password creation link is valid for ${expiresInDays} day${expiresInDays === 1 ? "" : "s"}.</div>
  </div>
  <div style="margin:8px 0;">
    <div style="font-size:10px;color:#64748b;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Account details</div>
    <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;">
        <tr>
          <td style="padding:12px 14px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:700;width:180px;border-bottom:1px solid #eef2f7;">User ID</td>
          <td style="padding:12px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #eef2f7;">${username}</td>
        </tr>
        <tr>
          <td style="padding:12px 14px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:700;border-bottom:1px solid #eef2f7;">Temporary Password</td>
          <td style="padding:12px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #eef2f7;">${password}</td>
        </tr>
        <tr>
          <td style="padding:12px 14px;background:#f8fafc;font-size:12px;color:#64748b;font-weight:700;">Sign in after setup</td>
          <td style="padding:12px 14px;font-size:13px;color:#1d4ed8;font-weight:600;"><a href="${loginUrl}" style="color:#1d4ed8;text-decoration:none;">${loginUrl}</a></td>
        </tr>
      </table>
    </div>
  </div>
  <div style="margin-top:18px;font-size:13px;color:#64748b;line-height:1.65;">
    Use the button above to create your own password. Enter the temporary password as Older Password.
    After creating your own password, you can log in using either your email address or User ID.
  </div>`;
}

export async function render({
  recipientName,
  username,
  password,
  loginUrl,
  createPasswordUrl,
  expiresInDays = 7,
}) {
  const safeName = escapeHtml(recipientName || "there");
  const days = Number(expiresInDays) || 7;
  const content = renderContent({
    safeName,
    username: escapeHtml(username),
    password: escapeHtml(password),
    loginUrl: escapeHtml(loginUrl),
    createPasswordUrl: escapeHtml(createPasswordUrl),
    expiresInDays: days,
  });

  return {
    subject: "Welcome to ADSecurity",
    html: await wrapCertificationEmail(content, {
      headerSubtitle: "ADSecurity",
      badgeLabel: "Welcome",
      documentTitle: "Welcome to ADSecurity",
      preheader: "Create your own password to start using ADSecurity.",
      footerNote: `Create Own Password links expire in ${days} days.`,
    }),
  };
}
