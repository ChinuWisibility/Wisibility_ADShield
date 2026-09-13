import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../../middleware/auth.js';
import Entitlement from '../../models/access/Entitlement.js';
import Account from '../../models/access/Account.js';
import EntitlementHierarchy from '../../models/access/EntitlementHierarchy.js';
import EntitlementOwnershipReview from '../../models/access/EntitlementOwnershipReview.js';
import { createCrudController } from '../../utils/crudFactory.js';

const router = Router();
const ctrl = createCrudController(Entitlement, { searchFields: ['name', 'displayName', 'applicationName'] });
const hierarchyCtrl = createCrudController(EntitlementHierarchy, { searchFields: ['relationship'] });
const ownershipCtrl = createCrudController(EntitlementOwnershipReview, { searchFields: ['currentOwner', 'newOwner', 'reviewStatus'] });

router.get('/', authenticate, ctrl.list);
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const [total, highRisk, privileged, byApp, byRisk] = await Promise.all([
      Entitlement.countDocuments(),
      Entitlement.countDocuments({ riskLevel: { $in: ['HIGH', 'CRITICAL'] } }),
      Entitlement.countDocuments({ isPrivileged: true }),
      Entitlement.aggregate([{ $group: { _id: '$applicationName', count: { $sum: 1 } } }]),
      Entitlement.aggregate([{ $group: { _id: '$riskLevel', count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: { total, highRisk, privileged, byApp, byRisk } });
  } catch (err) { next(err); }
});
router.get('/:id', authenticate, ctrl.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), ctrl.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.remove);

router.put('/:id/risk', authenticate, authorize(ROLES.ADMIN), async (req, res, next) => {
  try {
    const ent = await Entitlement.findByIdAndUpdate(req.params.id, { riskLevel: req.body.riskLevel }, { new: true });
    res.json({ success: true, data: ent });
  } catch (err) { next(err); }
});

router.put('/:id/owner', authenticate, authorize(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { owner, ownerEmail } = req.body;
    const ent = await Entitlement.findByIdAndUpdate(req.params.id, { owner, ownerEmail }, { new: true });
    res.json({ success: true, data: ent });
  } catch (err) { next(err); }
});

router.get('/:id/users', authenticate, async (req, res, next) => {
  try {
    const ent = await Entitlement.findById(req.params.id);
    const accounts = await Account.find({ application: ent.application, entitlements: ent.name }).populate('identity', 'displayName email department');
    res.json({ success: true, data: accounts });
  } catch (err) { next(err); }
});

// Entitlement hierarchy (Medium)
router.get('/hierarchy', authenticate, hierarchyCtrl.list);
router.get('/hierarchy/:id', authenticate, hierarchyCtrl.getById);
router.post('/hierarchy', authenticate, authorize(ROLES.ADMIN), hierarchyCtrl.create);
router.put('/hierarchy/:id', authenticate, authorize(ROLES.ADMIN), hierarchyCtrl.update);
router.delete('/hierarchy/:id', authenticate, authorize(ROLES.ADMIN), hierarchyCtrl.remove);

// Entitlement ownership reviews (Medium)
router.get('/ownership-reviews', authenticate, ownershipCtrl.list);
router.get('/ownership-reviews/:id', authenticate, ownershipCtrl.getById);
router.post('/ownership-reviews', authenticate, authorize(ROLES.ADMIN), ownershipCtrl.create);
router.put('/ownership-reviews/:id', authenticate, authorize(ROLES.ADMIN), ownershipCtrl.update);
router.delete('/ownership-reviews/:id', authenticate, authorize(ROLES.ADMIN), ownershipCtrl.remove);

export default router;
