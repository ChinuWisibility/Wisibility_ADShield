import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../../middleware/auth.js';
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  enableJob,
  disableJob,
  triggerJob,
  jobHealth,
  listLocks,
  getLockStatus,
  releaseLock,
} from '../../controllers/jobs/jobController.js';

const router = Router();

// Health must be before /:id to avoid conflict
router.get('/health', authenticate, authorize(ROLES.ADMIN), jobHealth);

// Lock management
router.get('/locks', authenticate, authorize(ROLES.ADMIN), listLocks);
router.get('/locks/:key', authenticate, authorize(ROLES.ADMIN), getLockStatus);
router.delete('/locks/:key', authenticate, authorize(ROLES.ADMIN), releaseLock);

// Job CRUD
router.get('/', authenticate, authorize(ROLES.ADMIN), listJobs);
router.post('/', authenticate, authorize(ROLES.ADMIN), createJob);
router.get('/:id', authenticate, authorize(ROLES.ADMIN), getJob);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), updateJob);
router.put('/:id/enable', authenticate, authorize(ROLES.ADMIN), enableJob);
router.put('/:id/disable', authenticate, authorize(ROLES.ADMIN), disableJob);
router.post('/:id/trigger', authenticate, authorize(ROLES.ADMIN), triggerJob);

export default router;
