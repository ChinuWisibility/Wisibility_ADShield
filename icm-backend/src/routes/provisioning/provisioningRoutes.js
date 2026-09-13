import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../../middleware/auth.js';
import { createCrudController } from '../../utils/crudFactory.js';
import ProvisioningRequest from '../../models/provisioning/ProvisioningRequest.js';
import ProvisioningPlan from '../../models/provisioning/ProvisioningPlan.js';
import ProvisioningTask from '../../models/provisioning/ProvisioningTask.js';
import ProvisioningResult from '../../models/provisioning/ProvisioningResult.js';
import DeprovisioningRecord from '../../models/provisioning/DeprovisioningRecord.js';
import {
  listRules,
  createRule,
  updateRule,
  removeRule,
  approveJoiner,
  rejectJoiner,
  evaluateJoiner,
  runProvisioningTask,
  retryProvisioningTask,
  listRecentJoinerCandidates,
} from '../../controllers/provisioning/joinerProvisioningController.js';
import {
  listLifecycleRequests,
  listRecentLifecycleEvents,
} from '../../controllers/provisioning/provisioningOverviewController.js';

const router = Router();

const requestCtrl = createCrudController(ProvisioningRequest, { searchFields: ['requestType', 'status', 'priority', 'sourceType', 'sourceId'] });
const planCtrl = createCrudController(ProvisioningPlan, { searchFields: ['status'] });
const taskCtrl = createCrudController(ProvisioningTask, { searchFields: ['status', 'operationType', 'errorMessage'] });
const resultCtrl = createCrudController(ProvisioningResult, { searchFields: ['statusCode'] });
const deprovCtrl = createCrudController(DeprovisioningRecord, { searchFields: ['status'] });

// Identity Provisioning Rules (WHO)
router.get('/identity-rules', authenticate, authorize(ROLES.ADMIN), listRules);
router.post('/identity-rules', authenticate, authorize(ROLES.ADMIN), createRule);
router.put('/identity-rules/:id', authenticate, authorize(ROLES.ADMIN), updateRule);
router.delete('/identity-rules/:id', authenticate, authorize(ROLES.ADMIN), removeRule);

// Joiner approval + evaluation
router.post('/joiner/:requestId/approve', authenticate, authorize(ROLES.ADMIN), approveJoiner);
router.post('/joiner/:requestId/reject', authenticate, authorize(ROLES.ADMIN), rejectJoiner);
router.post('/joiner/evaluate', authenticate, authorize(ROLES.ADMIN), evaluateJoiner);
router.get('/joiner/candidates', authenticate, authorize(ROLES.ADMIN), listRecentJoinerCandidates);
router.post('/tasks/:taskId/run', authenticate, authorize(ROLES.ADMIN), runProvisioningTask);
router.post('/tasks/:taskId/retry', authenticate, authorize(ROLES.ADMIN), retryProvisioningTask);

// Denormalized JML view for the Provisioning console (request + approval + plan + tasks + result)
router.get('/lifecycle-requests', authenticate, authorize(ROLES.ADMIN), listLifecycleRequests);
router.get('/lifecycle-events', authenticate, authorize(ROLES.ADMIN), listRecentLifecycleEvents);

// Requests
router.get('/requests', authenticate, requestCtrl.list);
router.get('/requests/:id', authenticate, requestCtrl.getById);
router.post('/requests', authenticate, authorize(ROLES.ADMIN), requestCtrl.create);
router.put('/requests/:id', authenticate, authorize(ROLES.ADMIN), requestCtrl.update);
router.delete('/requests/:id', authenticate, authorize(ROLES.ADMIN), requestCtrl.remove);

// Plans
router.get('/plans', authenticate, planCtrl.list);
router.get('/plans/:id', authenticate, planCtrl.getById);
router.post('/plans', authenticate, authorize(ROLES.ADMIN), planCtrl.create);
router.put('/plans/:id', authenticate, authorize(ROLES.ADMIN), planCtrl.update);
router.delete('/plans/:id', authenticate, authorize(ROLES.ADMIN), planCtrl.remove);

// Tasks
router.get('/tasks', authenticate, taskCtrl.list);
router.get('/tasks/:id', authenticate, taskCtrl.getById);
router.post('/tasks', authenticate, authorize(ROLES.ADMIN), taskCtrl.create);
router.put('/tasks/:id', authenticate, authorize(ROLES.ADMIN), taskCtrl.update);
router.delete('/tasks/:id', authenticate, authorize(ROLES.ADMIN), taskCtrl.remove);

// Results
router.get('/results', authenticate, resultCtrl.list);
router.get('/results/:id', authenticate, resultCtrl.getById);
router.post('/results', authenticate, authorize(ROLES.ADMIN), resultCtrl.create);
router.put('/results/:id', authenticate, authorize(ROLES.ADMIN), resultCtrl.update);
router.delete('/results/:id', authenticate, authorize(ROLES.ADMIN), resultCtrl.remove);

// Deprovisioning records
router.get('/deprovisioning', authenticate, deprovCtrl.list);
router.get('/deprovisioning/:id', authenticate, deprovCtrl.getById);
router.post('/deprovisioning', authenticate, authorize(ROLES.ADMIN), deprovCtrl.create);
router.put('/deprovisioning/:id', authenticate, authorize(ROLES.ADMIN), deprovCtrl.update);
router.delete('/deprovisioning/:id', authenticate, authorize(ROLES.ADMIN), deprovCtrl.remove);

export default router;
