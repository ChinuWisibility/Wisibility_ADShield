import express from "express";
import { authenticate } from "../../middleware/auth.js";
import { can, PRESETS } from "../../middleware/auth.js";
import {
  listIdentityProfilesForCertification,
  getIdentitiesForIdentityProfileCertification,
  getManagersForIdentityProfile,
  checkCampaignReadiness,
} from "../../controllers/access-certification/profileCertificationController.js";

const router = express.Router();

router.use(authenticate);
router.use(can(PRESETS.certRead));

// Identity profile lookups
router.get("/identity-profiles", listIdentityProfilesForCertification);
router.get("/identity-profiles/:id/identities", getIdentitiesForIdentityProfileCertification);

// Manager selection for PROFILE + MANAGER certification
// Returns managers who have direct reports in the given identity profile.
router.get("/identity-profiles/:profileId/managers", getManagersForIdentityProfile);

// Pre-activation readiness check for PROFILE-scope campaigns
router.get("/campaigns/:campaignId/readiness", checkCampaignReadiness);

export default router;
