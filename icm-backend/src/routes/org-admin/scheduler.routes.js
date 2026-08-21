import { Router } from 'express';
import * as ctrl from '../../controllers/org-admin/schedulerController.js';

const router = Router();

router.get('/config', ctrl.getConfig);
router.put('/config', ctrl.putConfig);
router.post('/dummy-records', ctrl.postDummyRecords);
router.delete('/dummy-records', ctrl.deleteDummyRecords);
router.post('/run-now', ctrl.postRunNow);
router.get('/stats', ctrl.getStats);
router.get('/dashboard', ctrl.getDashboard);
router.get('/execution-logs', ctrl.getExecutionLogs);
router.delete('/execution-logs', ctrl.deleteExecutionLogs);

export default router;
