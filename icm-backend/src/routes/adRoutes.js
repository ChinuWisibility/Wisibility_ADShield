import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getSuggestedAppGroups,
  getSuggestedApps,
  onboardApplications,
  previewGroupRuleMatches,
  recomputeSuggestions,
  refreshSuggestions,
} from "../controllers/adSuggestionController.js";

const router = Router();

router.get("/suggested-apps", authenticate, getSuggestedApps);
router.get("/suggested-apps/groups", authenticate, getSuggestedAppGroups);
router.post("/refresh-suggestions", authenticate, refreshSuggestions);
router.post("/recompute-suggestions", authenticate, recomputeSuggestions);
router.post("/preview-group-matches", authenticate, previewGroupRuleMatches);
router.post("/onboard-applications", authenticate, onboardApplications);

export default router;
