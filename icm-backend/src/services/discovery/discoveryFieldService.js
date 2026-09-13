import Application from '../../models/application/Application.js';
import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { getDynamicEntitlementModelForTenantId } from '../../models/application/Entitlements.js';

/**
 * Discover available fields for a given application + entity type.
 * Samples documents from the dynamic collection and extracts all unique keys,
 * including nested keys under `rawData`.
 *
 * @param {string} applicationId - MongoDB ObjectId of the application
 * @param {'USER'|'ENTITLEMENT'} entityType
 * @returns {Promise<Array<{ fieldName: string, sampleValues: string[], fieldType: string }>>}
 */
export async function getAvailableFields(applicationId, entityType) {
  const app = await Application.findById(applicationId).select('name tenantId').lean();
  if (!app?.name) return [];

  const Model =
    entityType === 'USER'
      ? await getDynamicUserModelForTenantId(app.name, app.tenantId)
      : await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);

  // Sample up to 100 docs to discover keys
  const samples = await Model.find({ applicationId })
    .limit(100)
    .lean();

  if (samples.length === 0) {
    // Fallback: try without applicationId filter (some legacy collections don't have it)
    const fallback = await Model.find({}).limit(100).lean();
    if (fallback.length === 0) return [];
    samples.push(...fallback);
  }

  const fieldMap = new Map(); // fieldName → Set of sample values

  // Internal fields to exclude from the builder UI
  const EXCLUDE_KEYS = new Set([
    '_id', '__v', 'applicationId', 'createdAt', 'updatedAt', 'rawData',
  ]);

  for (const doc of samples) {
    const flat = flattenDocument(doc);
    for (const [key, value] of Object.entries(flat)) {
      if (EXCLUDE_KEYS.has(key)) continue;
      if (!fieldMap.has(key)) fieldMap.set(key, new Set());
      const valStr = String(value ?? '').trim();
      if (valStr && fieldMap.get(key).size < 5) {
        fieldMap.get(key).add(valStr);
      }
    }
  }

  return Array.from(fieldMap.entries())
    .map(([fieldName, valuesSet]) => ({
      fieldName,
      sampleValues: Array.from(valuesSet),
      fieldType: 'string',
    }))
    .sort((a, b) => a.fieldName.localeCompare(b.fieldName));
}

/**
 * Flatten a Mongoose lean document into top-level key-value pairs.
 * Nested objects under `rawData` are flattened with dot notation.
 */
function flattenDocument(doc, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(doc)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (key === 'rawData' && value && typeof value === 'object' && !Array.isArray(value)) {
      // Flatten rawData children as rawData.childKey
      flattenDocument(value, 'rawData', result);
    } else if (value !== null && value !== undefined && typeof value !== 'object') {
      result[fullKey] = value;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[fullKey] = value;
    }
  }
  return result;
}
