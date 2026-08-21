/**
 * ISO 27001 Annex A — access review reporting (e.g. A.5.20) backed by Access Certification data.
 *
 * Reads: Campaign, ReviewItem, CertificationEscalation, Application (name resolve), optional User.
 * Scope fallback rows use `loadScopeRowsForCampaign` from access certification (same entitlement / scope rules).
 */

export const ISO_REPORT_API_PATH = "/certifications/campaigns/iso-report";

export const ISO_REPORT_DECISION_LIMIT_DEFAULT = 1000;
export const ISO_REPORT_DECISION_LIMIT_MAX = 5000;

/** Max campaigns processed for synthetic PENDING rows when ReviewItems are missing */
export const ISO_REPORT_SCOPE_FALLBACK_MAX_CAMPAIGNS = 6;

/** Max scope rows per campaign in that fallback path */
export const ISO_REPORT_SCOPE_FALLBACK_MAX_ROWS = 200;

/** Categories where item display uses access / group labels from scope */
export const ISO_REPORT_ACCESS_SCOPED_CATEGORIES = [
  "ACCESS_ITEMS",
  "ROLE_COMPOSITION",
];

/**
 * selectedIds / identityFilter / campaignMode required so loadScopeRowsForCampaign
 * can apply ACCESS_ITEMS entitlement filtering correctly.
 */
export const ISO_REPORT_CAMPAIGN_SELECT_FIELDS =
  "_id name status category completionPercentage totalItems totalScope " +
  "approvedItems revokedItems pendingItems dueDate startDate endDate " +
  "applicationName applicationId tenantId reviewersAssigned selectedIds identityFilter campaignMode currentReview";

export const ISO_REPORT_REVIEW_ITEM_SELECT =
  "campaignId userId itemId itemName itemEmail itemManager itemManagerEmail itemDepartment itemTitle itemApplicationName itemAccessDetails category reviewerEmail reviewerName decision comment reviewedAt status entitlementDecisions";

export const ISO_REPORT_EMPTY_SUMMARY = {
  totalCampaigns: 0,
  activeCampaigns: 0,
  completedCampaigns: 0,
  totalCertified: 0,
  totalRevoked: 0,
  totalPending: 0,
  totalEscalated: 0,
  avgCompletionPct: 0,
};
