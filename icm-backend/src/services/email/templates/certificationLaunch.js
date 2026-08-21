import {

  wrapCertificationEmail,

  buildRichItemTable,

  buildCertEmailContent,

} from "../../certificationEmailTemplates.js";
import env from "../../../config/env.js";



/**

 * Certification launch (assignment) email template.

 * @returns {Promise<{ subject: string, html: string }>}

 */

export async function render({

  reviewerName,

  campaignName,

  campaignId,

  dueDate,

  approveAllToken,

  itemDecisions = [],

  scopeItems = [],

  reviewerJwt = null,

  category = "",

}) {
  const frontendUrl = env.frontendUrl;

  const safeName = reviewerName || "Reviewer";

  const itemCount = Math.max(

    Array.isArray(scopeItems) ? scopeItems.length : 0,

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

    isReminder: false,

    safeName,

    campaignName,

    itemCount,

    portalUrl,

    campaignUrl,

    tableHtml,

    dueDate,

  });



  return {

    subject: `[ACTION REQUIRED] Access Certification: ${campaignName}`,

    html: await wrapCertificationEmail(rendered, {

      category,

      isReminder: false,

    }),

  };

}


