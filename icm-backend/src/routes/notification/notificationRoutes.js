import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../../middleware/auth.js';
import * as templateCtrl from '../../controllers/notification/notificationTemplateController.js';

const router = Router();

router.get('/templates', authenticate, authorize(ROLES.ADMIN), templateCtrl.listTemplates);
router.get('/templates/:key', authenticate, authorize(ROLES.ADMIN), templateCtrl.getTemplate);
router.put('/templates/:key', authenticate, authorize(ROLES.ADMIN), templateCtrl.updateTemplate);
router.post('/templates/:key/preview', authenticate, authorize(ROLES.ADMIN), templateCtrl.previewTemplate);
router.post('/templates/:key/reset', authenticate, authorize(ROLES.ADMIN), templateCtrl.resetTemplate);

export default router;
