import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { postGovernanceIntelligenceExport } from "../../controllers/governance/governanceIntelligenceExportController.js";

const router = Router();

router.post("/export", authenticate, postGovernanceIntelligenceExport);

export default router;
