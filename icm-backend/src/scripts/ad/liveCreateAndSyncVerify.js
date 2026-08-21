#!/usr/bin/env node
/**
 * Live Step-1 AD create + Identity Sphere AD Sync verification.
 *
 * Usage (from icm-backend, with VPN / AD reachability):
 *   node src/scripts/ad/liveCreateAndSyncVerify.js \
 *     --applicationId=<mongoObjectId> \
 *     --targetOuDn='CN=Users,DC=wisibility,DC=lcl' \
 *     --upnSuffix=wisibility.lcl
 *
 * Never prints bind passwords. Creates a DISABLED test user IS_PROV_* and does not delete it.
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import {
  normalizeAdConfig,
  testAdConnection,
  createAdUser,
} from "../../services/adLdapService.js";
import { createAdSyncJob, getAdSyncJobForApplication } from "../../services/adSyncJobService.js";
import { runAdSyncPipeline } from "../../services/adSyncPipelineService.js";
import AccountAggregation from "../../models/access/AccountAggregation.js";

function arg(name, fallback = "") {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const applicationId = arg("applicationId");
const targetOuDn = arg("targetOuDn");
const upnSuffix = arg("upnSuffix");
const persistConfig = flag("persistConfig");

if (!applicationId || !targetOuDn || !upnSuffix) {
  console.error(
    "Required: --applicationId=... --targetOuDn=... --upnSuffix=...\nOptional: --persistConfig",
  );
  process.exit(1);
}

const ts = Date.now().toString(36).slice(-8);
const sam = `IS_PROV_${ts}`.slice(0, 20);

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.DB_NAME,
  serverSelectionTimeoutMS: 20000,
});

const apps = mongoose.connection.db.collection("applications");
const appDoc = await apps.findOne({ _id: new mongoose.Types.ObjectId(applicationId) });
if (!appDoc) {
  console.error("Application not found");
  process.exit(1);
}

const ad = { ...(appDoc.connectionConfig?.ad || {}) };
ad.targetOuDn = targetOuDn;
ad.upnSuffix = upnSuffix;

console.log(
  JSON.stringify(
    {
      applicationId,
      name: appDoc.name,
      url: ad.url,
      baseDn: ad.baseDn,
      targetOuDn,
      upnSuffix,
      testSam: sam,
    },
    null,
    2,
  ),
);

if (persistConfig) {
  await apps.updateOne(
    { _id: appDoc._id },
    {
      $set: {
        "connectionConfig.ad.targetOuDn": targetOuDn,
        "connectionConfig.ad.upnSuffix": upnSuffix,
      },
    },
  );
  console.log(JSON.stringify({ step: "persistConfig", ok: true }));
}

try {
  const test = await testAdConnection(ad);
  console.log(JSON.stringify({ step: "testConnection", ok: true, sampleCount: test.sampleCount }));
} catch (e) {
  console.log(JSON.stringify({ step: "testConnection", ok: false, error: e.message }));
  await mongoose.disconnect();
  process.exit(2);
}

let createResult;
try {
  createResult = await createAdUser(ad, {
    sAMAccountName: sam,
    givenName: "IS",
    sn: "ProvTest",
    displayName: `IS Prov Test ${ts}`,
    mail: `${sam}@${upnSuffix}`,
    department: "ADSecurity-Test",
    employeeID: sam,
  });
  console.log(
    JSON.stringify(
      {
        step: "createAdUser",
        ok: true,
        dn: createResult.dn,
        sAMAccountName: createResult.sAMAccountName,
        userPrincipalName: createResult.userPrincipalName,
        objectGUID: createResult.objectGUID,
        accountEnabled: createResult.accountEnabled,
        verified: createResult.verified,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log(
    JSON.stringify({
      step: "createAdUser",
      ok: false,
      error: e.message,
      code: e.code,
      existing: e.existing,
    }),
  );
  await mongoose.disconnect();
  process.exit(3);
}

const job = await createAdSyncJob({
  applicationId: appDoc._id,
  syncConfig: {
    maxUsers: 50000,
    maxGroups: 50000,
    syncGroups: true,
    syncScope: "total",
    bindPassword: ad.bindPassword,
  },
});
console.log(JSON.stringify({ step: "adSyncQueued", jobId: job.jobId }));
await runAdSyncPipeline(job.jobId);

const jobDoc = await getAdSyncJobForApplication(job.jobId, appDoc._id);
console.log(
  JSON.stringify({
    step: "adSync",
    status: jobDoc?.status,
    phase: jobDoc?.phase,
    error: jobDoc?.error || null,
    percent: jobDoc?.percent,
  }),
);

const agg = await AccountAggregation.findOne({
  applicationId: appDoc._id,
  $or: [
    { accountName: sam },
    { "rawAttributes.sAMAccountName": sam },
    ...(createResult.objectGUID ? [{ nativeAccountId: createResult.objectGUID }] : []),
  ],
}).lean();

console.log(
  JSON.stringify(
    {
      step: "ADSecurityVisibility",
      found: Boolean(agg),
      nativeAccountId: agg?.nativeAccountId || null,
      accountName: agg?.accountName || null,
      status: agg?.status || null,
      hasObjectGuidInRaw: Boolean(
        agg?.rawAttributes?.objectGUID || agg?.rawAttributes?.objectguid,
      ),
      dn: agg?.rawAttributes?.distinguishedName || null,
      upn: agg?.rawAttributes?.userPrincipalName || null,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify({
    final: {
      Created: createResult?.created ? "YES" : "NO",
      "Visible in AD Sync": jobDoc?.status === "completed" ? "YES" : "NO",
      "Visible in Identity Sphere": agg ? "YES" : "NO",
      sAMAccountName: sam,
      UPN: createResult?.userPrincipalName,
      DN: createResult?.dn,
      objectGUID: createResult?.objectGUID,
    },
  }),
);

await mongoose.disconnect();
process.exit(agg && jobDoc?.status === "completed" ? 0 : 4);
