import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import { csvFileFilter } from '../utils/uploadFilters.js';
import {
  getHrmsConfig,
  putHrmsConfig,
  startHrmsOAuth,
  hrmsOAuthCallback,
  testHrmsConnection,
  syncHrmsIdentities,
  listHrmsSources,
  createHrmsSource,
  updateHrmsSource,
  deleteHrmsSource,
  uploadHrmsDelimitedCsv,
  getHrmsDelimitedSchema,
} from '../controllers/hrmsIntegrationController.js';

const router = Router();

const adminOrTenant = authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CERT_ADMIN);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: csvFileFilter,
});

router.get('/sources', authenticate, adminOrTenant, listHrmsSources);
router.post('/sources', authenticate, adminOrTenant, createHrmsSource);
router.post(
  '/sources/:id/csv-upload',
  authenticate,
  adminOrTenant,
  upload.single('file'),
  uploadHrmsDelimitedCsv,
);
router.get('/sources/:id/delimited-schema', authenticate, adminOrTenant, getHrmsDelimitedSchema);
router.put('/sources/:id', authenticate, adminOrTenant, updateHrmsSource);
router.delete('/sources/:id', authenticate, adminOrTenant, deleteHrmsSource);

router.get('/config', authenticate, adminOrTenant, getHrmsConfig);
router.put('/config', authenticate, adminOrTenant, putHrmsConfig);
router.post('/oauth/start', authenticate, adminOrTenant, startHrmsOAuth);
router.get('/oauth/callback', hrmsOAuthCallback);
router.post('/test', authenticate, adminOrTenant, testHrmsConnection);
router.post('/sync-identities', authenticate, adminOrTenant, syncHrmsIdentities);

export default router;
