/**
 * Static verification: certification sends must enqueue, not send directly.
 * Run: node scripts/qa/verifyCertEmailSendPaths.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, "../../src");

const CERT_SEND_SITES = [
  "controllers/access-certification/campaignController.js",
  "controllers/access-certification/settingsController.js",
  "jobs/certificationScheduler.js",
  "services/email/escalationService.js",
];

const ALLOWED_DIRECT_SEND = ["services/email/emailWorkerService.js"];

function read(file) {
  return fs.readFileSync(path.join(srcRoot, file), "utf8");
}

function checkFile(relativePath, requireEnqueue = true) {
  const content = read(relativePath);
  const hasEnqueue = content.includes("enqueueCertificationEmail");
  const hasDirectSend =
    content.includes("EmailService.send") ||
    /\bsendEmail\s*\(/.test(content);

  if (requireEnqueue && !hasEnqueue && relativePath.includes("escalation")) {
    return { file: relativePath, ok: !hasDirectSend, note: "no enqueue (may be optional)" };
  }

  if (requireEnqueue) {
    const ok = hasEnqueue && !hasDirectSend;
    return {
      file: relativePath,
      ok,
      hasEnqueue,
      hasDirectSend,
    };
  }

  return {
    file: relativePath,
    ok: hasDirectSend,
    hasDirectSend,
  };
}

function main() {
  let failed = false;

  console.log("[verify-send-paths] Certification enqueue sites:");
  for (const file of CERT_SEND_SITES) {
    const result = checkFile(file, true);
    console.log(`  ${result.ok ? "OK" : "FAIL"} ${file}`, result);
    if (!result.ok) failed = true;
  }

  console.log("[verify-send-paths] Allowed direct send (worker only):");
  for (const file of ALLOWED_DIRECT_SEND) {
    const result = checkFile(file, false);
    console.log(`  ${result.ok ? "OK" : "FAIL"} ${file}`, result);
    if (!result.ok) failed = true;
  }

  if (failed) {
    console.error("[verify-send-paths] FAILED — fix direct send paths");
    process.exit(1);
  }
  console.log("[verify-send-paths] ALL CHECKS PASSED");
}

main();
