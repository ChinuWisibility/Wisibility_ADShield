import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as prefCtrl from '../../controllers/system/preferenceController.js';

const router = Router();

router.get('/', authenticate, prefCtrl.getPreferences);
router.put('/', authenticate, prefCtrl.updatePreferences);
router.delete('/', authenticate, prefCtrl.resetPreferences);

export default router;
