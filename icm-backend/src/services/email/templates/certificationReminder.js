import {

  wrapCertificationEmail,

  buildRichItemTable,

  buildCertEmailContent,

} from "../../access-certification/certificationEmailTemplates.js";
import env from "../../../config/env.js";



/**

 * Certification reminder email template.

 * @returns {Promise<{ subject: string, html: string }>}

 */

export async function render({

  reviewerName,

  campaignName,

  campaignId,

  dueDate,

  pendingCount,

  approveAllToken,

  itemDecisions = [],

  scopeItems = [],

  reviewerJwt = null,

  category = "",

}) {
  const frontendUrl = env.frontendUrl;

  const safeName = reviewerName || "Reviewer";

  const scopeCount = Array.isArray(scopeItems) ? scopeItems.length : 0;

  const itemCount = Math.max(

    scopeCount,

    pendingCount ?? 0,

    itemDecisions.length || 0,

  );

  const campaignUrl = `${frontendUrl}/governance/certifications/access?campaign=${campaignId}`;

  const portalUrl = reviewerJwt

    ? `${frontendUrl}/cert-review?token=${encodeURIComponent(reviewerJwt)}`

    : approveAllToken

      ? `${frontendUrl}/cert-review?token=${approveAllToken}`

      : itemDecisions[0]?.approveToken

        ? `${frontendUrl}/cert-review?token=${itemDecisions[0].approveToken}`

        : null;



  const tableHtml =

    scopeItems.length > 0 ? buildRichItemTable(scopeItems) : "";

  const rendered = buildCertEmailContent({

    isReminder: true,

    safeName,

    campaignName,

    itemCount,

    portalUrl,

    campaignUrl,

    tableHtml,

    dueDate,

  });



  return {

    subject: `[REMINDER] Access Certification: ${campaignName}`,

    html: await wrapCertificationEmail(rendered, {

      category,

      isReminder: true,

    }),

  };

}


