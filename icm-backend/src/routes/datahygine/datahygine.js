import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import {
  getDatahygineSummary,
  getDataHygieneWidgetItems,
  getDataHygieneSummaryStatusHandler,
} from "../../controllers/datahygine/datahygineController.js";

const router = Router();

router.get("/summary", authenticate, getDatahygineSummary);
router.get("/summary/status", authenticate, getDataHygieneSummaryStatusHandler);
router.get("/widget-items", authenticate, getDataHygieneWidgetItems);

export default router;
