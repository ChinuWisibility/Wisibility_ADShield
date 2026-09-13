import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as widgetCtrl from '../../controllers/system/dashboardWidgetController.js';

const router = Router();

router.get('/widgets', authenticate, widgetCtrl.getWidgets);
router.put('/widgets', authenticate, widgetCtrl.saveWidgets);
router.delete('/widgets', authenticate, widgetCtrl.resetWidgets);

export default router;
