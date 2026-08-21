import { sendEmail } from "../emailService.js";

function formatDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function previewRows(items = [], limit = 5) {
  return items.slice(0, limit).map((item) => ({
    name: item.itemName || "Unknown",
    email: item.itemEmail || "—",
    application: item.applicationName || "—",
    entitlement: item.entitlementName || "—",
  }));
}

export function buildItsmTicketEmailHtml({
  ticketNumber,
  title,
  description,
  priority,
  dueDate,
  campaignNames = [],
  items = [],
  reviewUrl,
  requesterName,
  requesterEmail,
}) {
  const rows = previewRows(items);
  const moreCount = Math.max(0, items.length - rows.length);

  const userRowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${r.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${r.email}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${r.application}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#475569;">${r.entitlement}</td>
      </tr>`,
    )
    .join("");

  const campaignsHtml = campaignNames
    .map(
      (c) =>
        `<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;margin:0 6px 6px 0;">${c}</span>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f4c81 0%,#1d4ed8 100%);padding:28px 32px;color:#ffffff;">
            <div style="display:block;font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;">ITSM Remediation Ticket</div>
            <div style="font-size:26px;font-weight:800;margin-top:8px;">Action Required</div>
            <div style="display:block;font-size:14px;margin-top:8px;opacity:0.92;">Ticket ${ticketNumber}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
              <strong style="color:#92400e;font-size:14px;">Review revoked access requests and submit grant/deny decisions.</strong>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Title</td>
                <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;">${title || "Revoke Access Remediation"}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;">Priority</td>
                <td style="padding:8px 0;font-size:14px;color:#0f172a;">${priority || "MEDIUM"}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;">Due Date</td>
                <td style="padding:8px 0;font-size:14px;color:#0f172a;">${formatDate(dueDate)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;">Requested By</td>
                <td style="padding:8px 0;font-size:14px;color:#0f172a;">${requesterName || requesterEmail || "System"}</td>
              </tr>
            </table>
            ${description ? `<p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 20px;">${description}</p>` : ""}
            <div style="margin-bottom:20px;">
              <div style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Campaigns</div>
              ${campaignsHtml || '<span style="color:#64748b;font-size:13px;">—</span>'}
            </div>
            <div style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 10px;">Revoked Users Preview (${items.length})</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th align="left" style="padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">User</th>
                  <th align="left" style="padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">Email</th>
                  <th align="left" style="padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">Application</th>
                  <th align="left" style="padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">Entitlement</th>
                </tr>
              </thead>
              <tbody>${userRowsHtml}</tbody>
            </table>
            ${moreCount > 0 ? `<p style="font-size:12px;color:#64748b;margin:10px 0 0;">+ ${moreCount} more user(s) in this ticket</p>` : ""}
            <div style="text-align:center;margin:28px 0 8px;">
              <a href="${reviewUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;">Review Ticket</a>
            </div>
            <p style="font-size:12px;color:#94a3b8;text-align:center;margin-top:16px;">This secure review link expires per tenant policy. Do not forward outside authorized ITSM staff.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">Wisibility Identity Sphere · Remediation Framework · ITSM Notification</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendItsmTicketEmail(payload) {
  const html = buildItsmTicketEmailHtml(payload);
  const subject = `[ITSM Remediation] ${payload.ticketNumber} — ${payload.title || "Revoke Access Review Required"}`;
  await sendEmail({ to: payload.itsmEmail, subject, html });
  return { status: "SENT" };
}
