import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import ConnectorConfig from '../models/application/ConnectorConfig.js';
import { createCrudController } from '../utils/crudFactory.js';

const router = Router();
const ctrl = createCrudController(ConnectorConfig, { searchFields: ['connectorType', 'connectorVersion', 'syncType', 'lastSyncStatus'] });

router.get('/', authenticate, ctrl.list);
router.get('/:id', authenticate, ctrl.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), ctrl.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.remove);

export default router;

