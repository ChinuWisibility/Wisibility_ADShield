import { getBranding } from "../system/brandingService.js";
import { getLogoImage } from "../system/logoService.js";
import env from "../../config/env.js";

export const EMAIL_LOGO_CID = "wisibility-logo@branding";

async function resolveLogoForEmail(logoRef) {
  const logoId = logoRef?._id || logoRef;
  if (!logoId) return null;

  try {
    const logo = await getLogoImage(String(logoId));
    if (logo?.data?.length) {
      return `cid:${EMAIL_LOGO_CID}`;
    }
  } catch {
    // fall through to URL
  }

  const fileUrl = logoRef?.fileUrl;
  if (!fileUrl) return null;
  if (fileUrl.startsWith("http")) return fileUrl;
  return `${env.backendUrl}${fileUrl}`;
}

async function resolveBrandingForEmail() {
  try {
    const branding = await getBranding();
    const logoUrl = await resolveLogoForEmail(branding.logoId);
    return {
      companyName: branding.companyName || "Wisibility",
      logoUrl,
    };
  } catch {
    return { companyName: "Wisibility", logoUrl: null };
  }
}

/** Inline logo attachment for email clients that block remote or data-URI images. */
export async function getLogoEmailAttachment() {
  try {
    const branding = await getBranding();
    const logoId = branding.logoId?._id || branding.logoId;
    if (!logoId) return null;

    const logo = await getLogoImage(String(logoId));
    if (!logo?.data?.length) return null;

    return {
      filename: logo.fileName || "logo.png",
      content: logo.data,
      cid: EMAIL_LOGO_CID,
      contentType: logo.mimeType || "image/png",
    };
  } catch {
    return null;
  }
}

/** Attach branding logo at send time (queue stores HTML with cid: reference). */
export async function prepareCertificationEmailForSend(html) {
  const attachment = await getLogoEmailAttachment();
  if (!attachment || !String(html || "").includes(EMAIL_LOGO_CID)) {
    return { html, attachments: [] };
  }
  return { html, attachments: [attachment] };
}

/** Branded certification email shell with transparent logo on dark header. */
export async function wrapCertificationEmail(
  content,
  {
    category = "",
    isReminder = false,
    headerSubtitle,
    badgeLabel: badgeLabelOverride,
    documentTitle,
    preheader,
    footerNote,
  } = {},
) {
  const { companyName, logoUrl } = await resolveBrandingForEmail();
  const cat = String(category || "").toUpperCase().trim();
  const titleMap = {
    SOD: "Segregation of Duties Certification",
    SENSITIVE_ACCESS: "Sensitive Access Certification",
    DATA_ACCESS: "Data Access Governance Review",
    ROLE_COMPOSITION: "Role Entitlement Review",
    IDENTITY: "Identity Access Certification",
    ACCESS_ITEMS: "Application Access Certification",
  };
  const subtitle =
    headerSubtitle ||
    titleMap[cat] ||
    (cat ? `${cat.replace(/_/g, " ")} Certification` : "Access Certification Review");
  const badgeLabel = badgeLabelOverride || (isReminder ? "Reminder" : "Action Required");
  const badgeBg = isReminder ? "rgba(251,191,36,0.18)" : "rgba(96,165,250,0.18)";
  const badgeBorder = isReminder ? "rgba(251,191,36,0.45)" : "rgba(96,165,250,0.45)";
  const badgeColor = isReminder ? "#fde68a" : "#bfdbfe";
  const title = documentTitle || `${companyName} — Access Certification`;
  const hiddenPreheader =
    preheader || `${isReminder ? "Reminder" : "Action required"}: ${subtitle}`;
  const footer =
    footerNote || "Secure review links expire in 48 hours.";

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" width="180" style="height:auto;max-height:48px;max-width:180px;width:auto;display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`
    : `<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:.04em;line-height:1.2;">${companyName}</div>
       <div style="margin-top:4px;font-size:10px;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase;font-weight:600;">Identity Governance</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${hiddenPreheader}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;">
        <tr><td style="padding:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0c1929 0%,#1a365d 55%,#0f2744 100%);border-radius:16px 16px 0 0;">
            <tr>
              <td style="padding:22px 26px 20px;vertical-align:middle;">
                ${logoBlock}
                <div style="margin-top:10px;font-size:13px;color:#cbd5e1;font-weight:500;line-height:1.4;">${subtitle}</div>
              </td>
              <td align="right" style="padding:22px 26px 20px;vertical-align:top;">
                <div style="display:inline-block;background:${badgeBg};border:1px solid ${badgeBorder};border-radius:999px;padding:7px 14px;color:${badgeColor};font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;">${badgeLabel}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbe4ee;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;box-shadow:0 12px 40px rgba(15,23,42,0.08);">
            <tr><td style="padding:28px 26px 24px;">${content}</td></tr>
            <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 26px;text-align:center;">
              <div style="font-size:11px;line-height:1.65;color:#64748b;">
                Automated message from <strong style="color:#334155;">${companyName}</strong>. Please do not reply.
                <br />${footer}
              </div>
            </td></tr>
          </table>
          <div style="padding:14px 8px 0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">
            © ${new Date().getFullYear()} ${companyName} · Identity Governance &amp; Administration
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function formatAccessCell(accessDetails) {
  if (!Array.isArray(accessDetails) || accessDetails.length === 0) {
    return '<span style="font-size:12px;color:#94a3b8;">—</span>';
  }
  const shown = accessDetails.slice(0, 3);
  const lines = shown
    .map(
      (a) =>
        `<span style="display:block;font-size:12px;font-weight:600;color:#0f172a;line-height:1.45;">${a}</span>`,
    )
    .join("");
  const more =
    accessDetails.length > 3
      ? `<span style="display:block;font-size:11px;color:#94a3b8;margin-top:2px;">+ ${accessDetails.length - 3} more</span>`
      : "";
  return lines + more;
}

export function buildRichItemTable(scopeItems) {
  const rows = scopeItems
    .map((item, idx) => {
      const rowBg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
      const accessCell = formatAccessCell(item.accessDetails);
      return `<tr>
        <td style="padding:12px 14px;background:${rowBg};vertical-align:top;border-bottom:1px solid #eef2f7;">
          <div style="font-weight:700;font-size:13px;color:#0f172a;">${item.identityName || "—"}</div>
          ${item.identityEmail ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${item.identityEmail}</div>` : ""}
        </td>
        <td style="padding:12px 14px;background:${rowBg};font-size:12px;font-weight:600;color:#1d4ed8;vertical-align:top;border-bottom:1px solid #eef2f7;">${item.appName || "—"}</td>
        <td style="padding:12px 14px;background:${rowBg};vertical-align:top;border-bottom:1px solid #eef2f7;">${accessCell}</td>
        <td style="padding:12px 14px;background:${rowBg};font-size:12px;color:#475569;vertical-align:top;border-bottom:1px solid #eef2f7;">${item.role || "—"}</td>
      </tr>`;
    })
    .join("");

  return `<div style="overflow-x:auto;margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;">
    <table style="width:100%;border-collapse:collapse;background:#ffffff;">
      <thead>
        <tr style="background:#f1f5f9;border-bottom:1px solid #e2e8f0;">
          <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Identity</th>
          <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Application</th>
          <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Access / Entitlement</th>
          <th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Role</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

export function buildCertEmailContent({
  isReminder,
  safeName,
  campaignName,
  itemCount,
  portalUrl,
  campaignUrl,
  tableHtml,
  dueDate,
}) {
  const heading = isReminder
    ? `Reminder: ${campaignName}`
    : `Access review for ${campaignName}`;

  const introText = isReminder
    ? `You have <strong style="color:#0f172a;">${itemCount} pending item${itemCount !== 1 ? "s" : ""}</strong> awaiting your review. Please complete before the deadline.`
    : `You have been assigned <strong style="color:#0f172a;">${itemCount} item${itemCount !== 1 ? "s" : ""}</strong> for access certification review.`;

  const dueDateStr = dueDate
    ? new Date(dueDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const ctaColor = isReminder ? "#ea580c" : "#2563eb";
  const ctaLabel = isReminder ? "Continue your review" : "Review access items";
  const ctaBg = isReminder
    ? "background:linear-gradient(180deg,#fff7ed 0%,#ffffff 100%);border:1px solid #fed7aa;"
    : "background:linear-gradient(180deg,#f8fafc 0%,#ffffff 100%);border:1px solid #e2e8f0;";

  return `
  <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.35;">${heading}</div>
  <div style="margin-top:12px;font-size:15px;color:#475569;line-height:1.65;">
    Hi <strong style="color:#0f172a;">${safeName}</strong>, ${introText}
  </div>
  ${dueDateStr ? `<div style="margin-top:16px;display:inline-block;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;font-size:13px;color:#92400e;font-weight:600;">Due date: ${dueDateStr}</div>` : ""}
  <div style="${ctaBg}border-radius:14px;padding:22px;margin:22px 0;text-align:center;">
    ${portalUrl ? `<a href="${portalUrl}" style="display:inline-block;background:${ctaColor};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:10px;padding:14px 28px;">${ctaLabel}</a>
    <div style="font-size:12px;color:#64748b;line-height:1.6;margin-top:12px;">Secure review portal — link expires in 48 hours.</div>` : ""}
  </div>
  ${tableHtml ? `<div style="margin:8px 0;"><div style="font-size:10px;color:#64748b;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Summary of items</div>${tableHtml}</div>` : ""}
  <div style="text-align:center;margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0;">
    <a href="${campaignUrl}" style="display:inline-block;padding:11px 18px;background:#ffffff;color:#2563eb;font-size:13px;font-weight:700;text-decoration:none;border-radius:10px;border:1px solid #bfdbfe;">Open certification dashboard</a>
  </div>`;
}
