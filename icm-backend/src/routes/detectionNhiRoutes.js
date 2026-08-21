import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import { createCrudController } from '../utils/crudFactory.js';
import NHIProfile from '../models/detectionNhi/NHIProfile.js';
import PrivilegedAccessRecord from '../models/detectionNhi/PrivilegedAccessRecord.js';
import SecurityAlert from '../models/detectionNhi/SecurityAlert.js';
import AIEntitlementDescription from '../models/detectionNhi/AIEntitlementDescription.js';

const router = Router();

const nhiCtrl = createCrudController(NHIProfile, { searchFields: ['nhiType', 'ownerEmail', 'serviceDescription', 'reviewStatus'] });
const privCtrl = createCrudController(PrivilegedAccessRecord, { searchFields: ['privilegeType', 'certificationStatus'] });
const alertCtrl = createCrudController(SecurityAlert, { searchFields: ['alertType', 'severity', 'entityType', 'entityId', 'status'] });
const aiEntCtrl = createCrudController(AIEntitlementDescription, { searchFields: ['provider', 'model', 'reviewStatus'] });

router.get('/nhi-profiles', authenticate, nhiCtrl.list);
router.get('/nhi-profiles/:id', authenticate, nhiCtrl.getById);
router.post('/nhi-profiles', authenticate, authorize(ROLES.ADMIN), nhiCtrl.create);
router.put('/nhi-profiles/:id', authenticate, authorize(ROLES.ADMIN), nhiCtrl.update);
router.delete('/nhi-profiles/:id', authenticate, authorize(ROLES.ADMIN), nhiCtrl.remove);

router.get('/privileged-access', authenticate, privCtrl.list);
router.get('/privileged-access/:id', authenticate, privCtrl.getById);
router.post('/privileged-access', authenticate, authorize(ROLES.ADMIN), privCtrl.create);
router.put('/privileged-access/:id', authenticate, authorize(ROLES.ADMIN), privCtrl.update);
router.delete('/privileged-access/:id', authenticate, authorize(ROLES.ADMIN), privCtrl.remove);

router.get('/alerts', authenticate, alertCtrl.list);
router.get('/alerts/:id', authenticate, alertCtrl.getById);
router.post('/alerts', authenticate, authorize(ROLES.ADMIN), alertCtrl.create);
router.put('/alerts/:id', authenticate, authorize(ROLES.ADMIN), alertCtrl.update);
router.delete('/alerts/:id', authenticate, authorize(ROLES.ADMIN), alertCtrl.remove);

router.get('/ai-entitlement-descriptions', authenticate, aiEntCtrl.list);
router.get('/ai-entitlement-descriptions/:id', authenticate, aiEntCtrl.getById);
router.post('/ai-entitlement-descriptions', authenticate, authorize(ROLES.ADMIN), aiEntCtrl.create);
router.put('/ai-entitlement-descriptions/:id', authenticate, authorize(ROLES.ADMIN), aiEntCtrl.update);
router.delete('/ai-entitlement-descriptions/:id', authenticate, authorize(ROLES.ADMIN), aiEntCtrl.remove);

export default router;

