#!/usr/bin/env node
/**
 * Resolve a .NET SDK that can build net8.0, install one into ~/.dotnet if needed,
 * then run ADShield.Api (http://localhost:5088).
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHANNEL = "8.0";
const PREFIX = "[adshield]";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ADSHIELD_DIR = path.join(ROOT, "icm-backend", "ADShield");
const PROJECT = path.join(ADSHIELD_DIR, "src", "ADShield.Api", "ADShield.Api.csproj");
const INSTALL_DIR = process.env.DOTNET_INSTALL_DIR || path.join(os.homedir(), ".dotnet");
const IS_WIN = process.platform === "win32";
const DOTNET_NAME = IS_WIN ? "dotnet.exe" : "dotnet";

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function fail(message, err) {
  console.error(`${PREFIX} ${message}`);
  if (err?.message) console.error(`${PREFIX} ${err.message}`);
  process.exit(1);
}

function exists(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  }
}

function whichOnPath(bin) {
  try {
    const cmd = IS_WIN ? "where" : "which";
    const out = execFileSync(cmd, [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split(/\r?\n/)
      .find(Boolean);
    return out || null;
  } catch {
    return null;
  }
}

function candidateDotnets() {
  const seen = new Set();
  const list = [];
  const add = (p) => {
    if (!p || seen.has(p) || !exists(p)) return;
    seen.add(p);
    list.push(p);
  };

  add(whichOnPath(DOTNET_NAME));
  if (process.env.DOTNET_ROOT) add(path.join(process.env.DOTNET_ROOT, DOTNET_NAME));
  add(path.join(INSTALL_DIR, DOTNET_NAME));
  if (!IS_WIN) {
    add("/usr/local/share/dotnet/dotnet");
    add("/usr/share/dotnet/dotnet");
  } else {
    add("C:\\Program Files\\dotnet\\dotnet.exe");
  }
  return list;
}

function sdkMajor(line) {
  const m = String(line).match(/^(\d+)\./);
  return m ? Number(m[1]) : 0;
}

function canBuildNet8(dotnetBin) {
  try {
    const out = execFileSync(dotnetBin, ["--list-sdks"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: withDotnetEnv(dotnetBin),
    });
    return out.split(/\r?\n/).some((line) => sdkMajor(line) >= 8);
  } catch {
    return false;
  }
}

function withDotnetEnv(dotnetBin, extra = {}) {
  const root = path.dirname(dotnetBin);
  const pathKey = IS_WIN
    ? Object.keys(process.env).find((k) => k.toLowerCase() === "path") || "Path"
    : "PATH";
  const sep = IS_WIN ? ";" : ":";
  const current = process.env[pathKey] || "";
  const prefixed = current.split(sep).includes(root) ? current : `${root}${sep}${current}`;
  return {
    ...process.env,
    ...extra,
    DOTNET_ROOT: root,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    [pathKey]: prefixed,
  };
}

function followDownload(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      reject(new Error(`Too many redirects fetching ${url}`));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "adshield-dev" } }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          followDownload(new URL(loc, url).href, dest, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed (${res.statusCode}): ${url}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function downloadInstallScript() {
  const ext = IS_WIN ? "ps1" : "sh";
  const dest = path.join(os.tmpdir(), `dotnet-install-${process.pid}.${ext}`);
  const url = `https://dot.net/v1/dotnet-install.${ext}`;
  log(`Downloading .NET install script from ${url}`);

  const curl = whichOnPath("curl");
  if (curl && !IS_WIN) {
    const r = spawnSync(curl, ["-fsSL", url, "-o", dest], { stdio: "inherit" });
    if (r.status === 0 && exists(dest)) return dest;
  }

  await followDownload(url, dest);
  return dest;
}

function runInstall(scriptPath) {
  log(`Installing .NET SDK ${CHANNEL} into ${INSTALL_DIR} (user-local, no admin required)`);
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  if (IS_WIN) {
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Channel",
        CHANNEL,
        "-Quality",
        "ga",
        "-InstallDir",
        INSTALL_DIR,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) fail("dotnet-install.ps1 failed.");
    return;
  }

  fs.chmodSync(scriptPath, 0o755);
  const bash = whichOnPath("bash") || "/bin/bash";
  const r = spawnSync(
    bash,
    [scriptPath, "--channel", CHANNEL, "--quality", "ga", "--install-dir", INSTALL_DIR],
    { stdio: "inherit" },
  );
  if (r.status !== 0) fail("dotnet-install.sh failed. Check network access and retry.");
}

async function ensureDotnet() {
  const existing = candidateDotnets().find(canBuildNet8);
  if (existing) {
    log(`Using ${existing}`);
    return existing;
  }

  if (candidateDotnets().length) {
    log("dotnet was found but no SDK >= 8.0 is installed (needed for ADShield.Api / net8.0).");
  } else {
    log("dotnet was not found on PATH.");
  }

  const script = await downloadInstallScript();
  try {
    runInstall(script);
  } finally {
    try {
      fs.unlinkSync(script);
    } catch {
      /* ignore */
    }
  }

  const installed = path.join(INSTALL_DIR, DOTNET_NAME);
  if (!exists(installed) || !canBuildNet8(installed)) {
    fail(`Installed dotnet at ${installed} but it cannot build net8.0.`);
  }
  log(`Installed ${installed}`);
  return installed;
}

function runApi(dotnetBin) {
  if (!exists(PROJECT)) fail(`ADShield project not found: ${PROJECT}`);

  const env = withDotnetEnv(dotnetBin, {
    ASPNETCORE_ENVIRONMENT: "Development",
    ASPNETCORE_URLS: process.env.ASPNETCORE_URLS || "http://localhost:5088",
  });

  log(`Starting ADShield.Api at ${env.ASPNETCORE_URLS}`);
  const child = spawn(
    dotnetBin,
    ["run", "--project", PROJECT, "--no-launch-profile"],
    { cwd: ADSHIELD_DIR, env, stdio: "inherit" },
  );

  const stop = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}

const dotnetBin = await ensureDotnet();
runApi(dotnetBin);
