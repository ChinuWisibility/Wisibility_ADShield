import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getIdentityProfiles,
  getIdentityProfileById,
  getIdentityProfileCreateSchema,
  getIdentityProfileReferenceOptions,
  getIdentityProfileAttributeValues,
  createIdentityProfile,
  updateIdentityProfile,
  deleteIdentityProfile,
  getTargetAttributeMeta,
  getTenantMappedIdentityFields,
  getProfileSourceApplications,
  getIdentityProfileReadiness,
  putIdentityProfileMappings,
  postIdentityProfileMappingsPreview,
  postImportIdentitiesFromDelimited,
  postAggregateDelimitedCheck,
  postIdentityRefresh,
  getMaterializationLockStatus,
  postBulkTenantIdentityMaterialization,
  getBulkTenantMaterializationJob,
  getIdentityProfileDeletionImpact,
  patchIdentityProfileDraft,
  clearIdentityProfileDraft,
  getManagerCorrelationPreview,
} from '../controllers/identity/identityProfileController.js';

const router = Router();

router.get('/meta/target-attributes', authenticate, getTargetAttributeMeta);
router.get('/meta/mapped-fields', authenticate, getTenantMappedIdentityFields);
router.get('/meta/profile-source-applications', authenticate, getProfileSourceApplications);

/** Tenant enqueue lock (identity refresh / save+sync) — poll for busy state across browsers. */
router.get('/materialization/lock-status', authenticate, getMaterializationLockStatus);
/** Poll job from POST …/bulk-refresh when it returned 202. */
router.get('/materialization/bulk-refresh/jobs/:jobId', authenticate, getBulkTenantMaterializationJob);
/** One lock for all mapped profiles (Identities page "Identity refresh"). Default async (202 + jobId). */
router.post('/materialization/bulk-refresh', authenticate, postBulkTenantIdentityMaterialization);

// FR-074: List Profiles & FR-076: Create Profile
router.route('/')
  .get(authenticate, getIdentityProfiles)
  .post(authenticate, createIdentityProfile);

router.put('/:id/mappings', authenticate, putIdentityProfileMappings);
router.post('/:id/mappings/preview', authenticate, postIdentityProfileMappingsPreview);
router.post('/:id/import-from-delimited', authenticate, postImportIdentitiesFromDelimited);
router.get('/:id/readiness', authenticate, getIdentityProfileReadiness);
router.post('/:id/aggregate-delimited', authenticate, postAggregateDelimitedCheck);
router.post('/:id/identity-refresh', authenticate, postIdentityRefresh);
router.get('/:id/deletion-impact', authenticate, getIdentityProfileDeletionImpact);

/** Field list for the manual "create identity" form, derived from this profile's mappings. */
router.get('/:id/create-schema', authenticate, getIdentityProfileCreateSchema);
router.get('/:id/reference-options', authenticate, getIdentityProfileReferenceOptions);
/** Values already seen for one mapped attribute, so rule conditions match real data. */
router.get('/:id/attribute-values', authenticate, getIdentityProfileAttributeValues);

/** Draft: save without validation (PATCH) / clear draft (DELETE). */
router.patch('/:id/draft', authenticate, patchIdentityProfileDraft);
router.delete('/:id/draft', authenticate, clearIdentityProfileDraft);

/** Inline manager correlation preview (Settings tab). */
router.get('/:id/manager-correlation-preview', authenticate, getManagerCorrelationPreview);

// FR-075: Get details, FR-077: Update, FR-078: Delete specific profile
router.route('/:id')
  .get(authenticate, getIdentityProfileById)
  .put(authenticate, updateIdentityProfile)
  .delete(authenticate, deleteIdentityProfile);

export default router;
