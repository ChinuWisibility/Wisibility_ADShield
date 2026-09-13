import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../middleware/auth.js';
import Account from '../models/access/Account.js';
import AccountAggregation from '../models/access/AccountAggregation.js';
import AccountLifecycleLog from '../models/access/AccountLifecycleLog.js';
import { createCrudController } from '../utils/crudFactory.js';

const router = Router();
const ctrl = createCrudController(Account, { searchFields: ['nativeIdentity', 'displayName', 'applicationName', 'identityName'] });
const aggregationCtrl = createCrudController(AccountAggregation, { searchFields: ['nativeAccountId', 'accountName', 'status', 'accountType'] });
const lifecycleCtrl = createCrudController(AccountLifecycleLog, { searchFields: ['action', 'triggeredBy', 'previousStatus', 'newStatus', 'errorMessage'] });

router.get('/', authenticate, ctrl.list);
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const [total, orphan, privileged, byStatus, byApp] = await Promise.all([
      Account.countDocuments(),
      Account.countDocuments({ isOrphan: true }),
      Account.countDocuments({ isPrivileged: true }),
      Account.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Account.aggregate([{ $group: { _id: '$applicationName', count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: { total, orphan, privileged, byStatus, byApp } });
  } catch (err) { next(err); }
});
router.get('/orphans', authenticate, async (req, res, next) => {
  try {
    const orphans = await Account.find({ isOrphan: true }).populate('application', 'name type');
    res.json({ success: true, data: orphans });
  } catch (err) { next(err); }
});

// Privileged accounts for ISO report — matches isPrivileged:true OR accountType in privileged/admin
router.get('/privileged', authenticate, async (req, res, next) => {
  try {
    const { application, limit = 500, page = 1 } = req.query;
    const query = {
      $or: [
        { isPrivileged: true },
        { accountType: { $in: ['privileged', 'admin'] } },
      ],
    };
    if (application) query.application = application;
    if (req.user?.tenantId && req.user.role !== 'superAdmin') {
      query.tenantId = req.user.tenantId;
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Account.find(query).sort({ accountType: 1, nativeIdentity: 1 }).skip(skip).limit(Number(limit)).lean(),
      Account.countDocuments(query),
    ]);
    res.json({ success: true, data: { items, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, ctrl.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), ctrl.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), ctrl.remove);
router.get('/:id/entitlements', authenticate, async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    res.json({ success: true, data: { entitlements: account?.entitlements || [], groups: account?.groups || [] } });
  } catch (err) { next(err); }
});

// Account aggregation (v2)
router.get('/aggregation', authenticate, aggregationCtrl.list);
router.get('/aggregation/:id', authenticate, aggregationCtrl.getById);
router.post('/aggregation', authenticate, authorize(ROLES.ADMIN), aggregationCtrl.create);
router.put('/aggregation/:id', authenticate, authorize(ROLES.ADMIN), aggregationCtrl.update);
router.delete('/aggregation/:id', authenticate, authorize(ROLES.ADMIN), aggregationCtrl.remove);

// Account lifecycle logs (High priority)
router.get('/lifecycle', authenticate, lifecycleCtrl.list);
router.get('/lifecycle/:id', authenticate, lifecycleCtrl.getById);
router.post('/lifecycle', authenticate, authorize(ROLES.ADMIN), lifecycleCtrl.create);
router.put('/lifecycle/:id', authenticate, authorize(ROLES.ADMIN), lifecycleCtrl.update);
router.delete('/lifecycle/:id', authenticate, authorize(ROLES.ADMIN), lifecycleCtrl.remove);

export default router;
