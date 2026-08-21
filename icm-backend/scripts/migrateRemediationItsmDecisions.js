/**
 * One-time migration: map DENY_REQUEST ticket items/responses to PENDING.
 *
 * Usage: node scripts/migrateRemediationItsmDecisions.js
 * Requires MONGODB_URI and DB_NAME in environment (same as icm-backend).
 */

import mongoose from "mongoose";
import "../src/config/env.js";
import env from "../src/config/env.js";
import RemediationTicketItem from "../src/models/remediation/RemediationTicketItem.js";
import RemediationTicketResponse from "../src/models/remediation/RemediationTicketResponse.js";

async function main() {
  await mongoose.connect(env.mongodb.uri, { dbName: env.mongodb.dbName });
  console.log("[migrateRemediationItsmDecisions] connected");

  const itemResult = await RemediationTicketItem.updateMany(
    { decision: "DENY_REQUEST" },
    {
      $set: {
        decision: "PENDING",
        status: "PENDING_DECISION",
        comment: "Migrated from DENY_REQUEST",
      },
    },
  );

  const responseResult = await RemediationTicketResponse.updateMany(
    { decision: "DENY_REQUEST" },
    {
      $set: {
        decision: "PENDING",
        comment: "Migrated from DENY_REQUEST",
      },
    },
  );

  console.log(
    `[migrateRemediationItsmDecisions] items updated: ${itemResult.modifiedCount}, responses updated: ${responseResult.modifiedCount}`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
