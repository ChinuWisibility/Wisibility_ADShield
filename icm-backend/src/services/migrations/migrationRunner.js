import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { writeVersionMetadata } from "../../config/versionMetadata.js";
import env from "../../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveMigrationsDir() {
  const candidates = [
    path.join(env.paths?.home || "", "app", "backend", "migrations"),
    path.resolve(env.paths?.packageRoot || "", "migrations"),
    path.resolve(__dirname, "../../migrations"),
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(dir)) return dir;
  }
  return path.resolve(__dirname, "../../migrations");
}

/**
 * Apply pending numbered migration scripts (001_*.js, …).
 * Tracks applied ids in `_migrations` collection.
 */
export async function runPendingMigrations() {
  const dir = resolveMigrationsDir();
  if (!fs.existsSync(dir)) {
    console.log("[migrations] No migrations directory — skipping");
    return { applied: [], skipped: true };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3,}_.+\.js$/.test(f))
    .sort();

  if (!files.length) {
    console.log("[migrations] No migration files found");
    return { applied: [], skipped: false };
  }

  const db = mongoose.connection.db;
  const col = db.collection("_migrations");
  await col.createIndex({ id: 1 }, { unique: true });

  const applied = [];
  for (const file of files) {
    const id = file.replace(/\.js$/, "");
    const existing = await col.findOne({ id });
    if (existing) continue;

    const full = path.join(dir, file);
    console.log(`[migrations] Applying ${id}…`);
    const mod = await import(pathToFileUrl(full));
    const fn = mod.default || mod.up;
    if (typeof fn !== "function") {
      throw new Error(`Migration ${id} must export default or up()`);
    }
    await fn({ db, mongoose });
    await col.insertOne({ id, appliedAt: new Date(), file });
    applied.push(id);
    console.log(`[migrations] Applied ${id}`);
  }

  if (applied.length && env.paths?.versionPath) {
    const latest = applied[applied.length - 1];
    const schemaMatch = latest.match(/^(\d+)/);
    const schemaVersion = schemaMatch ? parseInt(schemaMatch[1], 10) : undefined;
    writeVersionMetadata(env.paths.versionPath, {
      schemaVersion: schemaVersion || applied.length,
    });
  }

  return { applied, skipped: false };
}

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath);
  if (process.platform === "win32") {
    return `file:///${resolved.replace(/\\/g, "/")}`;
  }
  return `file://${resolved}`;
}
