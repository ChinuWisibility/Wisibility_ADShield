import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { createCrudController } from '../../utils/crudFactory.js';
import CorrelationRule from '../../models/correlation/CorrelationRule.js';
import CorrelationResult from '../../models/correlation/CorrelationResult.js';

// --- IMPORT THE ENGINE WE JUST BUILT ---
import {
  runCorrelationForApp,
  previewManualCorrelationForApp,
  getCorrelatedAccounts,
  getOrphanAccounts,
  getOrphanAccountsIsoSummary,
  getOrphanAccountsIsoFull,
  remediateOrphan,
} from '../../controllers/correlation/correlationController.js';

const router = Router();

/**
 * ==========================================
 * 1. CONFIGURATION (Your CRUD Factory Routes)
 * ==========================================
 */
const ruleCtrl = createCrudController(CorrelationRule, { searchFields: ['ruleName', 'identityAttribute', 'accountAttribute', 'matchType'] });
const resultCtrl = createCrudController(CorrelationResult, { searchFields: ['status'] });

// Rules
router.get('/rules', authenticate, ruleCtrl.list);
router.get('/rules/:id', authenticate, ruleCtrl.getById);
router.post('/rules', authenticate, ruleCtrl.create);
router.put('/rules/:id', authenticate, ruleCtrl.update);
router.delete('/rules/:id', authenticate, ruleCtrl.remove);

// Results
router.get('/results', authenticate, resultCtrl.list);
router.get('/results/:id', authenticate, resultCtrl.getById);
router.post('/results', authenticate, resultCtrl.create);
router.put('/results/:id', authenticate, resultCtrl.update);
router.delete('/results/:id', authenticate, resultCtrl.remove);


/**
 * ==========================================
 * 2. OPERATIONS (The Correlation Engine)
 * ==========================================
 */

// Dry-run manual correlation (same matching logic as /run; no writes)
router.post('/preview/:applicationId', authenticate, previewManualCorrelationForApp);

// Run manual correlation for a specific application (any authenticated user)
router.post('/run/:applicationId', authenticate, runCorrelationForApp);

// Identity ↔ target application links (tenant-scoped), with correlation key from last manual run when available
router.get('/correlated-accounts', authenticate, getCorrelatedAccounts);

// ISO governance: queue totals + chart digest (no row payload); detail rows via GET /orphans paged
router.get('/orphans/application/:applicationId/iso-summary', authenticate, getOrphanAccountsIsoSummary);

// ISO / exports: full OPEN orphan list (prefer paged /orphans + iso-summary for interactive UI)
router.get('/orphans/application/:applicationId/iso-full', authenticate, getOrphanAccountsIsoFull);

// Get all open Orphan Accounts across the whole system
router.get('/orphans', authenticate, getOrphanAccounts);

// Remediate a specific Orphan Account (Link it, Ignore it, etc.)
router.post('/orphans/:orphanId/remediate', authenticate, remediateOrphan);

export default router;
