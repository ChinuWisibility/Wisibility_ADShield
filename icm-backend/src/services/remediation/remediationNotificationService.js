import NotificationTemplate from "../../models/platform/NotificationTemplate.js";
import { sendEmail } from "../email/appEmailService.js";
import { resetTemplate } from "../system/notificationTemplateService.js";

function renderWithVariables(text, data) {
  if (!text) return "";
  let rendered = text;
  for (const [key, value] of Object.entries(data || {})) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    rendered = rendered.replace(pattern, String(value));
  }
  return rendered;
}

async function resolveTemplate(templateKey) {
  let template = await NotificationTemplate.findOne({ templateKey });
  if (template) return template;
  try {
    template = await resetTemplate(templateKey);
  } catch {
    return null;
  }
  return template;
}

export async function sendRemediationEmail({ templateKey, to, data }) {
  if (!templateKey || !to) {
    return { status: "SKIPPED", error: "Missing templateKey or recipient" };
  }

  const template = await resolveTemplate(templateKey);
  if (!template) {
    return { status: "FAILED", error: "Template not found" };
  }

  const subject = renderWithVariables(template.subject || "", data);
  const html = renderWithVariables(
    template.bodyHtml || template.bodyText || "",
    data,
  );

  await sendEmail({ to, subject, html });
  return { status: "SENT" };
}
