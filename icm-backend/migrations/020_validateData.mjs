import Campaign from "../src/models/certification/Campaign.js";
import ReviewItem from "../src/models/certification/ReviewItem.js";
import Entitlement from "../src/models/access/Entitlement.js";
import Identity from "../src/models/identity/Identity.js";
import SodPolicy from "../src/models/sod/SodPolicy.js";
import SodViolation from "../src/models/sod/SodViolation.js";
import NHIProfile from "../src/models/detectionNhi/NHIProfile.js";
import PrivilegedAccessRecord from "../src/models/detectionNhi/PrivilegedAccessRecord.js";

export default async function validateData() {
  const issues = {};

  // Access Certification
  issues.campaignMissingCategory = await Campaign.countDocuments({
    category: { $exists: false },
  });
  issues.campaignBadStatus = await Campaign.countDocuments({
    status: {
      $nin: [
        "Draft",
        "Scheduled",
        "Active",
        "DecisionPending",
        "Completed",
        "Closed",
      ],
    },
  });
  issues.campaignMissingTenantId = await Campaign.countDocuments({
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });

  issues.reviewItemMissingCampaignId = await ReviewItem.countDocuments({
    campaignId: { $exists: false },
  });
  issues.reviewItemMissingReviewedAt = await ReviewItem.countDocuments({
    status: { $ne: "PENDING" },
    reviewedAt: { $exists: false },
  });
  issues.reviewItemBadStatus = await ReviewItem.countDocuments({
    status: {
      $nin: [
        "PENDING",
        "APPROVED",
        "REVOKED",
        "DELEGATED",
        "EXCEPTION",
      ],
    },
  });
  issues.reviewItemMissingTenantId = await ReviewItem.countDocuments({
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });

  // Entitlements
  issues.entitlementMissingKey = await Entitlement.countDocuments({
    $or: [
      { applicationId: { $exists: false } },
      { entitlementName: { $exists: false } },
    ],
  });
  issues.entitlementBadRiskLevel = await Entitlement.countDocuments({
    riskLevel: { $nin: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
  });

  // Identity / SodUserIdentity
  issues.identityRiskOutOfRange = await Identity.countDocuments({
    $or: [{ riskScore: { $lt: 0 } }, { riskScore: { $gt: 100 } }],
  });
  issues.identityLifecycleBadState = await Identity.countDocuments({
    lifecycleState: {
      $nin: ["NEW", "ACTIVE", "MOVER", "LEAVER", "TERMINATED", "QUARANTINE", "INACTIVE"],
    },
  });

  // SoD
  issues.sodPolicyBadStatus = await SodPolicy.countDocuments({
    status: { $nin: ["active", "draft", "disabled", "archived"] },
  });
  issues.sodPolicyBadSeverity = await SodPolicy.countDocuments({
    severity: { $nin: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
  });
  issues.sodViolationBadSeverity = await SodViolation.countDocuments({
    severity: { $nin: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
  });
  issues.sodViolationRiskOutOfRange = await SodViolation.countDocuments({
    $or: [{ riskScore: { $lt: 0 } }, { riskScore: { $gt: 100 } }],
  });

  // NHI / privileged access
  issues.nhiProfileBadStatus = await NHIProfile.countDocuments({
    reviewStatus: { $nin: ["PENDING", "CONFIRMED", "FALSE_POSITIVE"] },
  });
  issues.privilegedAccessRiskOutOfRange =
    await PrivilegedAccessRecord.countDocuments({
      $or: [{ riskScore: { $lt: 0 } }, { riskScore: { $gt: 100 } }],
    });

  // eslint-disable-next-line no-console
  console.log("Migration validation summary:", issues);

  return issues;
}
