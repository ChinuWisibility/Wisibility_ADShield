import Application from "../models/application/Application.js";

let stubbedOnce = false;

/**
 * Backfill `hrms.connector: delimited_file` for App Registry apps that used the generic
 * DelimitedFile catalog connector but never received an `hrms` subdocument (identity profile / HRMS CSV list).
 */
export async function ensureDelimitedHrmsStubApplicationsOnce() {
  if (stubbedOnce) return;
  stubbedOnce = true;
  const types = ["HRMS_DELIMITED_FILE", "CONNECTOR_DELIMITEDFILE", "DELIMITEDFILE"];
  await Application.updateMany(
    {
      connectorType: { $in: types },
      $or: [{ hrms: { $exists: false } }, { "hrms.connector": { $exists: false } }],
    },
    { $set: { "hrms.connector": "delimited_file" } }
  );
}
