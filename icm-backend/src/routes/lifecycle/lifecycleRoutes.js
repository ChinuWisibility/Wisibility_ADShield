import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import LifecycleEvent from "../../models/identity/LifecycleEvent.js";
import { createCrudController } from "../../utils/crudFactory.js";

/**
 * Lifecycle events are system-generated. Expose read-only APIs only —
 * no create/update/delete so events cannot become a command-injection path.
 */
const router = Router();
const ctrl = createCrudController(LifecycleEvent, {
  searchFields: ["eventType", "eventStatus", "triggeredBy", "error", "jmlCorrelationId"],
});

router.get("/", authenticate, ctrl.list);
router.get("/:id", authenticate, ctrl.getById);

export default router;
