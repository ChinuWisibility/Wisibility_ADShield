import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
const dbName = process.env.DB_NAME || "IGA-V3";
if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

const masked = uri.replace(/\/\/([^:]+):([^@]+)@/, "//***:***@");
console.log("Connecting:", masked.split("/").slice(0, 3).join("/"));

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 120000 });
const db = mongoose.connection.db;
const dbNameResolved = db.databaseName;
console.log("Database:", dbNameResolved);

const tenants = await db.collection("tenants").countDocuments();
const apps = await db.collection("applications").countDocuments();
const appsWithTenant = await db.collection("applications").countDocuments({
  tenantId: { $exists: true, $ne: null },
});

console.log("tenants collection count:", tenants);
console.log("applications collection count:", apps);
console.log("applications with tenantId:", appsWithTenant);

if (tenants > 0) {
  const tSample = await db.collection("tenants").find({}).project({ name: 1, code: 1 }).limit(3).toArray();
  console.log("sample tenants:", JSON.stringify(tSample, null, 2));
}

if (apps > 0) {
  const aSample = await db.collection("applications").find({}).project({ name: 1, tenantId: 1 }).limit(5).toArray();
  console.log("sample applications:", JSON.stringify(aSample, null, 2));
}

await mongoose.disconnect();
