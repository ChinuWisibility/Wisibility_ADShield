import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import { createCrudController } from '../utils/crudFactory.js';
import ContractorProfile from '../models/identity/ContractorProfile.js';
import IdentityAccountLink from '../models/identity/IdentityAccountLink.js';
import IdentitySnapshot from '../models/identity/IdentitySnapshot.js';
import ManagerHierarchy from '../models/identity/ManagerHierarchy.js';
import OrphanAccount from '../models/identity/OrphanAccount.js';

const router = Router();

const contractorCtrl = createCrudController(ContractorProfile, { searchFields: ['vendorName', 'contractType'] });
const linkCtrl = createCrudController(IdentityAccountLink, { searchFields: ['accountId', 'accountName', 'correlationMethod'] });
const snapshotCtrl = createCrudController(IdentitySnapshot, { searchFields: ['snapshotType'] });
const hierarchyCtrl = createCrudController(ManagerHierarchy, { searchFields: [] });
const orphanCtrl = createCrudController(OrphanAccount, { searchFields: ['accountId', 'accountName', 'status', 'riskLevel'] });

// Contractor profiles
router.get('/contractors', authenticate, contractorCtrl.list);
router.get('/contractors/:id', authenticate, contractorCtrl.getById);
router.post('/contractors', authenticate, authorize(ROLES.ADMIN), contractorCtrl.create);
router.put('/contractors/:id', authenticate, authorize(ROLES.ADMIN), contractorCtrl.update);
router.delete('/contractors/:id', authenticate, authorize(ROLES.ADMIN), contractorCtrl.remove);

// Identity-account links
router.get('/account-links', authenticate, linkCtrl.list);
router.get('/account-links/:id', authenticate, linkCtrl.getById);
router.post('/account-links', authenticate, authorize(ROLES.ADMIN), linkCtrl.create);
router.put('/account-links/:id', authenticate, authorize(ROLES.ADMIN), linkCtrl.update);
router.delete('/account-links/:id', authenticate, authorize(ROLES.ADMIN), linkCtrl.remove);

// Identity snapshots
router.get('/snapshots', authenticate, snapshotCtrl.list);
router.get('/snapshots/:id', authenticate, snapshotCtrl.getById);
router.post('/snapshots', authenticate, authorize(ROLES.ADMIN), snapshotCtrl.create);
router.put('/snapshots/:id', authenticate, authorize(ROLES.ADMIN), snapshotCtrl.update);
router.delete('/snapshots/:id', authenticate, authorize(ROLES.ADMIN), snapshotCtrl.remove);

// Manager hierarchy
router.get('/manager-hierarchy', authenticate, hierarchyCtrl.list);
router.get('/manager-hierarchy/:id', authenticate, hierarchyCtrl.getById);
router.post('/manager-hierarchy', authenticate, authorize(ROLES.ADMIN), hierarchyCtrl.create);
router.put('/manager-hierarchy/:id', authenticate, authorize(ROLES.ADMIN), hierarchyCtrl.update);
router.delete('/manager-hierarchy/:id', authenticate, authorize(ROLES.ADMIN), hierarchyCtrl.remove);

// Orphan accounts
router.get('/orphan-accounts', authenticate, orphanCtrl.list);
router.get('/orphan-accounts/:id', authenticate, orphanCtrl.getById);
router.post('/orphan-accounts', authenticate, authorize(ROLES.ADMIN), orphanCtrl.create);
router.put('/orphan-accounts/:id', authenticate, authorize(ROLES.ADMIN), orphanCtrl.update);
router.delete('/orphan-accounts/:id', authenticate, authorize(ROLES.ADMIN), orphanCtrl.remove);

export default router;

