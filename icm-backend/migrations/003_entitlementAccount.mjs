import Entitlement from '../src/models/access/Entitlement.js';

export default async function migrateEntitlementAccount() {
  await migrateEntitlements();
}

async function migrateEntitlements() {
  const batchSize = 500;
  let lastId = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await Entitlement.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const update = {};

      if (!doc.entitlementName && doc.name) {
        update.entitlementName = doc.name;
      }
      if (!doc.applicationId && doc.application) {
        update.applicationId = doc.application;
      }
      if (!doc.riskLevel) {
        update.riskLevel = 'LOW';
      }

      if (Object.keys(update).length) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: update },
          },
        });
      }
    }

    if (ops.length) await Entitlement.bulkWrite(ops, { ordered: false });
    lastId = docs[docs.length - 1]._id;
  }
}

