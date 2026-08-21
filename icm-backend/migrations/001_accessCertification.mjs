import mongoose from 'mongoose';
import Campaign from '../src/models/certification/Campaign.js';

/**
 * Normalize Access Certification data to the new schema.
 * - Campaign: status enums, category defaults, recurrence flags.
 */
export default async function migrateAccessCertification() {
  await migrateCampaigns();
}

async function migrateCampaigns() {
  const statusMap = {
    draft: 'Draft',
    active: 'Active',
    in_progress: 'DecisionPending',
    completed: 'Completed',
    cancelled: 'Closed',
    overdue: 'Active',
  };

  const batchSize = 500;
  let lastId = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await Campaign.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const bulkOps = [];

    for (const doc of docs) {
      const update = {};

      // Status normalization (if still legacy)
      if (doc.status && statusMap[doc.status]) {
        update.status = statusMap[doc.status];
      }

      // Category default from legacy type/scope
      if (!doc.category) {
        const legacyType = doc.type;
        if (legacyType === 'manager') update.category = 'MANAGER';
        else if (legacyType === 'entitlement_owner' || legacyType === 'application_owner') update.category = 'ACCESS_ITEMS';
        else if (legacyType === 'identity') update.category = 'IDENTITY';
      }

      // Recurrence
      if (doc.isRecurring && doc.recurrenceEnabled === undefined) {
        update.recurrenceEnabled = true;
      }

      if (Object.keys(update).length) {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: update },
          },
        });
      }
    }

    if (bulkOps.length) {
      await Campaign.bulkWrite(bulkOps, { ordered: false });
    }

    lastId = docs[docs.length - 1]._id;
  }
}
