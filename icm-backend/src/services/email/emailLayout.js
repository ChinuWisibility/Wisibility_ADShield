import { getBranding } from "../system/brandingService.js";
import env from "../../config/env.js";

/** Branded shell for transactional (non-certification) emails. */
export async function wrapBrandedEmail(content, options = {}) {
  let branding;
  try {
    branding = await getBranding();
  } catch (error) {
    console.error("[Email] Failed to fetch branding:", error.message);
    branding = {
      companyName: "ADSecurity",
      primaryColor: "#2563EB",
      logoId: null,
    };
  }

  const companyName = branding.companyName || "ADSecurity";
  const primaryColor = branding.primaryColor || "#2563EB";
  const subtitle =
    options.subtitle || "Identity Governance & Compliance Management Platform";

  let logoUrl = null;
  if (branding.logoId?.fileUrl) {
    const fileUrl = branding.logoId.fileUrl;
    logoUrl = fileUrl.startsWith("http")
      ? fileUrl
      : `${env.backendUrl}${fileUrl}`;
  }

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <title>${companyName}</title>
    </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;">
      <tr>
        <td align="center" style="padding:40px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;box-shadow:0 20px 60px rgba(15,23,42,0.12);overflow:hidden;">
            <tr>
              <td style="padding:32px 40px 24px;background-color:#ffffff;border-bottom:1px solid #f1f5f9;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td align="center">
                      ${
                        logoUrl
                          ? `<img src="${logoUrl}" alt="${companyName}" style="height:48px;max-width:200px;margin:0 auto 12px;display:block;" />`
                          : `<div style="width:48px;height:48px;margin:0 auto 12px;border-radius:12px;background:linear-gradient(135deg,${primaryColor},#6366f1);text-align:center;line-height:48px;font-size:24px;">🔐</div>`
                      }
                      <div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:4px;">${companyName}</div>
                      <div style="font-size:12px;color:#94a3b8;">${subtitle}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:40px 40px;background-color:#ffffff;">${content}</td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;padding:32px 40px;text-align:center;">
                <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
                <p style="margin:0;font-size:11px;color:#cbd5e1;">${companyName} · Identity Governance &amp; Administration</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}
