import { Router } from "express";
import { requireSetupToken } from "../../middleware/setupAuth.js";
import { postInitialize } from "../../controllers/setup/setupController.js";

const router = Router();

router.post("/initialize", requireSetupToken, postInitialize);

export default router;
