import mongoose from "mongoose";

/**
 * Assigns missing policyId (POL-XXX) on sod_policies, per tenant, preserving creation order.
 * Safe to run multiple times (only updates docs without policyId).
 */
export default async function backfillSodPolicyIds() {
  const coll = mongoose.connection.db.collection("sod_policies");
  const cursor = coll.find({
    $or: [{ policyId: { $exists: false } }, { policyId: null }, { policyId: "" }],
  });

  const docs = await cursor.toArray();
  if (!docs.length) {
    // eslint-disable-next-line no-console
    console.log("[022_backfillSodPolicyIds] No policies need policyId.");
    return;
  }

  const byTenant = new Map();
  for (const doc of docs) {
    const t = doc.tenantId != null ? String(doc.tenantId) : "__none__";
    if (!byTenant.has(t)) byTenant.set(t, []);
    byTenant.get(t).push(doc);
  }

  let updated = 0;
  for (const [tenantKey, tenantDocs] of byTenant) {
    const tenantFilter =
      tenantKey === "__none__"
        ? { $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: "" }] }
        : { tenantId: tenantKey };

    const existingWithId = await coll
      .find({ ...tenantFilter, policyId: { $regex: /^POL-\d+$/i } })
      .project({ policyId: 1 })
      .toArray();

    let max = 99;
    for (const e of existingWithId) {
      const m = String(e.policyId || "").match(/^POL-(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }

    tenantDocs.sort((a, b) => {
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ca - cb;
    });

    for (const doc of tenantDocs) {
      max += 1;
      const policyId = `POL-${max}`;
      await coll.updateOne({ _id: doc._id }, { $set: { policyId } });
      updated += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[022_backfillSodPolicyIds] Updated ${updated} policy document(s).`);
}
