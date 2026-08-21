import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  listReconciliationRuns,
  getReconciliationRun,
  listReconciliationDeltas,
  listEntitlementDeltas,
  listRunSnapshots,
} from "../controllers/reconciliationController.js";

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get("/runs", listReconciliationRuns);
router.get("/runs/:runId", getReconciliationRun);
router.get("/runs/:runId/deltas", listReconciliationDeltas);
router.get("/runs/:runId/entitlement-deltas", listEntitlementDeltas);
router.get("/runs/:runId/snapshots", listRunSnapshots);
router.get("/deltas", listReconciliationDeltas);
router.get("/entitlement-deltas", listEntitlementDeltas);

export default router;
