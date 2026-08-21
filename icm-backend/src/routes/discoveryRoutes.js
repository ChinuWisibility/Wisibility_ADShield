import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import * as discovery from '../controllers/discoveryController.js';

const router = Router();

const adminDiscovery = authorize(ROLES.ADMIN, ROLES.SOD_ADMIN);
const readDiscovery = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
  ROLES.AUDIT_ANALYTICS,
);

// ── Policy CRUD ──
router.get('/policies', authenticate, readDiscovery, discovery.listPolicies);
router.get('/policies/stats', authenticate, readDiscovery, discovery.getPolicyStats);
router.get('/policies/next-id', authenticate, adminDiscovery, discovery.getNextPolicyId);
router.get('/policies/:id', authenticate, readDiscovery, discovery.getPolicyById);
router.post('/policies', authenticate, adminDiscovery, discovery.createPolicy);
router.put('/policies/:id', authenticate, adminDiscovery, discovery.updatePolicy);
router.delete('/policies/:id', authenticate, authorize(ROLES.ADMIN), discovery.deletePolicy);
router.post('/policies/:id/clone', authenticate, adminDiscovery, discovery.clonePolicy);

// ── Evaluation ──
router.post('/policies/:id/evaluate', authenticate, adminDiscovery, discovery.evaluatePolicy);
router.post('/evaluate-all', authenticate, adminDiscovery, discovery.evaluateAll);

// ── Results ──
router.get('/results', authenticate, readDiscovery, discovery.listResults);
router.get('/results/summary', authenticate, readDiscovery, discovery.getResultsSummary);
router.put('/results/mark', authenticate, adminDiscovery, discovery.markResults);
router.put('/results/unmark', authenticate, adminDiscovery, discovery.unmarkResults);

// ── Field Discovery ──
router.get('/fields/:applicationId/:entityType', authenticate, adminDiscovery, discovery.getFields);

export default router;
