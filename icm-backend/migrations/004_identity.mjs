import Identity from '../src/models/identity/Identity.js';

export default async function migrateIdentity() {
  await migrateSodUserIdentity();
}

async function migrateSodUserIdentity() {
  // In your codebase, SodUserIdentity is represented by the Identity model (sod_user_identities collection)
  const batchSize = 500;
  let lastId = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await Identity.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const update = {};

      if (doc.riskScore == null) {
        update.riskScore = 0;
      } else if (doc.riskScore < 0 || doc.riskScore > 100) {
        update.riskScore = Math.max(0, Math.min(100, doc.riskScore));
      }

      if (doc.isNHI == null) {
        update.isNHI = false;
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

    if (ops.length) await Identity.bulkWrite(ops, { ordered: false });
    lastId = docs[docs.length - 1]._id;
  }
}

