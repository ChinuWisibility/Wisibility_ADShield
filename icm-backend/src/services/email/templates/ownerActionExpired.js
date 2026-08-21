import { wrapBrandedEmail } from "../emailLayout.js";
import env from "../../../config/env.js";

function renderContent({
  safeName,
  campaignName,
  applicationName,
  dueDateStr,
  renewUrl,
  closeUrl,
  revokeAllUrl,
}) {
  const appLine = applicationName
    ? `<p style="margin:0 0 6px;font-size:14px;color:#475569;line-height:1.6;"><strong>Application:</strong> ${applicationName}</p>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td>
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;">Hi ${safeName},</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">An access certification campaign has passed its due date and requires your decision as the application or campaign owner.</p>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px;">
  <tr><td style="background:linear-gradient(135deg,#fff1f2 0%,#ffe4e6 100%);border-left:4px solid #ef4444;border-radius:12px;padding:20px 24px;">
    <p style="margin:0 0 12px;font-size:14px;color:#0f172a;font-weight:600;">Campaign Expired — Action Required</p>
    <p style="margin:0 0 6px;font-size:14px;color:#475569;line-height:1.6;"><strong>Campaign:</strong> ${campaignName}</p>
    ${appLine}
    <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;"><strong>Was Due:</strong> ${dueDateStr}</p>
  </td></tr>
</table>
<p style="margin:0 0 16px;font-size:14px;color:#0f172a;font-weight:600;">Choose an action:</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
  <tr><td align="center">
    <a href="${renewUrl}" style="display:inline-block;margin:0 8px 8px;padding:14px 28px;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:12px;">Renew Campaign</a>
    <a href="${closeUrl}" style="display:inline-block;margin:0 8px 8px;padding:14px 28px;background:#059669;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:12px;">Close &amp; Approve All</a>
    <a href="${revokeAllUrl}" style="display:inline-block;margin:0 8px 8px;padding:14px 28px;background:#dc2626;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:12px;">Revoke All Pending</a>
  </td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr><td style="background-color:#f8fafc;border-radius:12px;padding:16px 20px;">
    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;"><strong>Renew</strong> extends the deadline and reopens the campaign. <strong>Close &amp; Approve All</strong> approves all remaining access and closes the campaign. <strong>Revoke All Pending</strong> revokes remaining items (you may close the campaign separately in the portal).</p>
  </td></tr>
</table>`;
}

export async function render({
  ownerName,
  campaignName,
  campaignId,
  applicationName,
  dueDate,
}) {
  const frontendUrl = env.frontendUrl;
  const safeName = ownerName || "Application Owner";
  const dueDateStr = dueDate
    ? new Date(dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "N/A";
  const base = `${frontendUrl}/governance/certifications/access?campaignId=${campaignId}`;
  const renewUrl = `${base}&ownerIntent=EXTEND`;
  const closeUrl = `${base}&ownerIntent=CLOSE`;
  const revokeAllUrl = `${base}&campaign=${campaignId}&bulkIntent=REVOKE_ALL`;

  const content = renderContent({
    safeName,
    campaignName,
    applicationName,
    dueDateStr,
    renewUrl,
    closeUrl,
    revokeAllUrl,
  });

  return {
    subject: `[Action Required] Expired Certification Campaign — ${campaignName}`,
    html: await wrapBrandedEmail(content, {
      subtitle: "Access Certification — Owner Action Required",
    }),
  };
}
