/**
 * Baseline migration — records schema version 1 for fresh installs.
 * @param {{ db: import('mongodb').Db }} ctx
 */
export default async function up(ctx) {
  // No structural changes — establishes migration bookkeeping.
  await ctx.db.collection("_schema_meta").updateOne(
    { _id: "ADSecurity" },
    {
      $set: {
        schemaVersion: 1,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}
