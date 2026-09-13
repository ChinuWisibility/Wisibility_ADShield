import { Router } from 'express';
import { authenticate, authorize, ROLES } from '../../middleware/auth.js';
import { createCrudController } from '../../utils/crudFactory.js';
import AccessOutlier from '../../models/accessIntelligence/AccessOutlier.js';
import PeerGroupAnalysis from '../../models/accessIntelligence/PeerGroupAnalysis.js';
import AccessRecommendation from '../../models/accessIntelligence/AccessRecommendation.js';
import RiskTrendSnapshot from '../../models/accessIntelligence/RiskTrendSnapshot.js';

const router = Router();
const outlierCtrl = createCrudController(AccessOutlier, { searchFields: ['status', 'recommendedAction'] });
const peerGroupCtrl = createCrudController(PeerGroupAnalysis, { searchFields: ['groupKey', 'runId'] });
const recCtrl = createCrudController(AccessRecommendation, { searchFields: ['recommendationType', 'status'] });
const trendCtrl = createCrudController(RiskTrendSnapshot, { searchFields: [] });

router.get('/outliers', authenticate, outlierCtrl.list);
router.get('/outliers/:id', authenticate, outlierCtrl.getById);
router.post('/outliers', authenticate, authorize(ROLES.ADMIN), outlierCtrl.create);
router.put('/outliers/:id', authenticate, authorize(ROLES.ADMIN), outlierCtrl.update);
router.delete('/outliers/:id', authenticate, authorize(ROLES.ADMIN), outlierCtrl.remove);

router.get('/peer-groups', authenticate, peerGroupCtrl.list);
router.get('/peer-groups/:id', authenticate, peerGroupCtrl.getById);
router.post('/peer-groups', authenticate, authorize(ROLES.ADMIN), peerGroupCtrl.create);
router.put('/peer-groups/:id', authenticate, authorize(ROLES.ADMIN), peerGroupCtrl.update);
router.delete('/peer-groups/:id', authenticate, authorize(ROLES.ADMIN), peerGroupCtrl.remove);

router.get('/recommendations', authenticate, recCtrl.list);
router.get('/recommendations/:id', authenticate, recCtrl.getById);
router.post('/recommendations', authenticate, authorize(ROLES.ADMIN), recCtrl.create);
router.put('/recommendations/:id', authenticate, authorize(ROLES.ADMIN), recCtrl.update);
router.delete('/recommendations/:id', authenticate, authorize(ROLES.ADMIN), recCtrl.remove);

router.get('/risk-trends', authenticate, trendCtrl.list);
router.get('/risk-trends/:id', authenticate, trendCtrl.getById);
router.post('/risk-trends', authenticate, authorize(ROLES.ADMIN), trendCtrl.create);
router.put('/risk-trends/:id', authenticate, authorize(ROLES.ADMIN), trendCtrl.update);
router.delete('/risk-trends/:id', authenticate, authorize(ROLES.ADMIN), trendCtrl.remove);

export default router;

