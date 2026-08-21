import AccessOutlier from '../src/models/accessIntelligence/AccessOutlier.js';
import AccessRecommendation from '../src/models/accessIntelligence/AccessRecommendation.js';
import PeerGroupAnalysis from '../src/models/accessIntelligence/PeerGroupAnalysis.js';
import RiskTrendSnapshot from '../src/models/accessIntelligence/RiskTrendSnapshot.js';

export default async function migrateAccessIntelligence() {
  await migrateAccessOutliers();
  await migrateAccessRecommendations();
  await migratePeerGroupAnalysis();
  await migrateRiskTrendSnapshots();
}

async function migrateAccessOutliers() {
  const batchSize = 500;
  let lastId = null;
  const now = new Date();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await AccessOutlier.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const update = {};

      if (doc.outlierScore == null) {
        update.outlierScore = 0;
      } else if (doc.outlierScore < 0 || doc.outlierScore > 100) {
        update.outlierScore = Math.max(0, Math.min(100, doc.outlierScore));
      }

      if (!doc.detectedAt) {
        update.detectedAt = doc.createdAt || now;
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

    if (ops.length) await AccessOutlier.bulkWrite(ops, { ordered: false });
    lastId = docs[docs.length - 1]._id;
  }
}

async function migrateAccessRecommendations() {
  const batchSize = 500;
  let lastId = null;
  const now = new Date();
  const defaultTtlMs = 30 * 24 * 60 * 60 * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await AccessRecommendation.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const update = {};

      if (doc.confidence == null) {
        update.confidence = 0.5;
      } else if (doc.confidence < 0 || doc.confidence > 1) {
        update.confidence = Math.max(0, Math.min(1, doc.confidence));
      }

      if (!doc.generatedAt) {
        update.generatedAt = doc.createdAt || now;
      }
      if (!doc.expiresAt) {
        const base = update.generatedAt || doc.generatedAt || now;
        update.expiresAt = new Date(base.getTime() + defaultTtlMs);
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

    if (ops.length) await AccessRecommendation.bulkWrite(ops, { ordered: false });
    lastId = docs[docs.length - 1]._id;
  }
}

async function migratePeerGroupAnalysis() {
  const batchSize = 500;
  let lastId = null;
  const now = new Date();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await PeerGroupAnalysis.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const update = {};

      if (!doc.analysisDate) update.analysisDate = doc.createdAt || now;
      if (!doc.outlierThreshold && doc.outlierThreshold !== 0) update.outlierThreshold = 20;

      if (Object.keys(update).length) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: update },
          },
        });
      }
    }

    if (ops.length) await PeerGroupAnalysis.bulkWrite(ops, { ordered: false });
    lastId = docs[docs.length - 1]._id;
  }
}

async function migrateRiskTrendSnapshots() {
  const batchSize = 500;
  let lastId = null;
  const now = new Date();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = lastId ? { _id: { $gt: lastId } } : {};
    const docs = await RiskTrendSnapshot.find(query).sort({ _id: 1 }).limit(batchSize);
    if (!docs.length) break;

    const ops = [];
    for (const doc of docs) {
      const update = {};

      if (doc.riskScore == null) {
        update.riskScore = 0;
      } else if (doc.riskScore < 0 || doc.riskScore > 100) {
        update.riskScore = Math.max(0, Math.min(100, doc.riskScore));
      }

      if (!doc.snapshotDate) {
        update.snapshotDate = doc.createdAt || now;
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

    if (ops.length) await RiskTrendSnapshot.bulkWrite(ops, { ordered: false });
    lastId = docs[docs.length - 1]._id;
  }
}

