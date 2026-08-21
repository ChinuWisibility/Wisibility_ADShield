#!/usr/bin/env node
/**
 * Copy ESM source tree to dist/ for production packaging.
 * Production entry: dist/server.js (never run src/ under WinSW).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");

function copyRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".test.js") || entry.name.endsWith(".spec.js")) {
        continue;
      }
      fs.copyFileSync(s, d);
    }
  }
}

if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
}
copyRecursive(src, dist);

// Stamp build metadata
fs.writeFileSync(
  path.join(dist, "BUILD_INFO.json"),
  `${JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      entry: "server.js",
      node: process.versions.node,
    },
    null,
    2,
  )}\n`,
);

console.log(`[build:dist] Wrote ${dist}/server.js`);
