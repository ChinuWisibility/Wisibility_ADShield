import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import Role from '../models/access/Role.js';
import RoleEntitlement from '../models/access/RoleEntitlement.js';
import { createCrudController } from '../utils/crudFactory.js';

const router = Router();
const ctrl = createCrudController(Role, { searchFields: ['name', 'displayName', 'description'] });
const roleEntitlementCtrl = createCrudController(RoleEntitlement, { searchFields: ['grantType', 'isActive'] });

router.get('/', authenticate, ctrl.list);
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const [total, active, byType, byRisk] = await Promise.all([
      Role.countDocuments(),
      Role.countDocuments({ status: 'active' }),
      Role.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      Role.aggregate([{ $group: { _id: '$riskLevel', count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: { total, active, byType, byRisk } });
  } catch (err) { next(err); }
});
router.get('/:id', authenticate, ctrl.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), ctrl.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.remove);

// Entitlements management
router.post('/:id/entitlements', authenticate, authorize(ROLES.ADMIN), async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    role.entitlements.push(req.body);
    role.totalEntitlements = role.entitlements.length;
    await role.save();
    res.json({ success: true, data: role });
  } catch (err) { next(err); }
});
router.delete('/:id/entitlements/:eid', authenticate, authorize(ROLES.ADMIN), async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    role.entitlements = role.entitlements.filter((e) => e._id.toString() !== req.params.eid);
    role.totalEntitlements = role.entitlements.length;
    await role.save();
    res.json({ success: true, data: role });
  } catch (err) { next(err); }
});

// Archive
router.put('/:id/archive', authenticate, authorize(ROLES.ADMIN), async (req, res, next) => {
  try {
    const role = await Role.findByIdAndUpdate(req.params.id, { status: 'archived', isActive: false }, { new: true });
    res.json({ success: true, data: role });
  } catch (err) { next(err); }
});

// Role entitlement junction (new)
router.get('/entitlements', authenticate, roleEntitlementCtrl.list);
router.get('/entitlements/:id', authenticate, roleEntitlementCtrl.getById);
router.post('/entitlements', authenticate, authorize(ROLES.ADMIN), roleEntitlementCtrl.create);
router.put('/entitlements/:id', authenticate, authorize(ROLES.ADMIN), roleEntitlementCtrl.update);
router.delete('/entitlements/:id', authenticate, authorize(ROLES.ADMIN), roleEntitlementCtrl.remove);

export default router;
