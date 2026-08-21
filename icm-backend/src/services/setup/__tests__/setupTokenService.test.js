import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  SETUP_TOKEN_TTL_MS,
  createSetupToken,
  assertValidSetupToken,
  deleteSetupToken,
  markSetupCompleted,
  isSetupCompleted,
  setupTokenPath,
  setupCompletedPath,
} from "../setupTokenService.js";

describe("setupTokenService", () => {
  /** @type {string} */
  let dataRoot;
  /** @type {string|undefined} */
  let prevData;

  beforeEach(async () => {
    dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "idsphere-setup-"));
    prevData = process.env.ADSecurity_DATA;
    // env.paths.data is resolved at module load — patch by writing under env's paths.
    // Tests import env already; override by spying on paths via rewriting files under a stub.
    const { default: env } = await import("../../../config/env.js");
    env.paths.data = dataRoot;
  });

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true });
    if (prevData === undefined) delete process.env.ADSecurity_DATA;
    else process.env.ADSecurity_DATA = prevData;
  });

  test("create and validate token", async () => {
    const { token, expiresAt } = await createSetupToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    await assertValidSetupToken(token);
    const onDisk = JSON.parse(await fs.readFile(setupTokenPath(), "utf8"));
    expect(onDisk.token).toBe(token);
  });

  test("rejects wrong token", async () => {
    await createSetupToken();
    await expect(assertValidSetupToken("0".repeat(64))).rejects.toMatchObject({
      code: "SETUP_TOKEN_INVALID",
    });
  });

  test("rejects expired token", async () => {
    const { token } = await createSetupToken();
    const payload = JSON.parse(await fs.readFile(setupTokenPath(), "utf8"));
    payload.expiresAt = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(setupTokenPath(), JSON.stringify(payload), "utf8");
    await expect(assertValidSetupToken(token)).rejects.toMatchObject({
      code: "SETUP_TOKEN_EXPIRED",
    });
  });

  test("markSetupCompleted deletes token and blocks further setup", async () => {
    const { token } = await createSetupToken();
    await markSetupCompleted({ adminEmail: "a@b.com" });
    expect(isSetupCompleted()).toBe(true);
    await expect(fs.access(setupTokenPath())).rejects.toBeTruthy();
    await expect(assertValidSetupToken(token)).rejects.toMatchObject({
      code: "SETUP_ALREADY_COMPLETED",
    });
    const done = JSON.parse(await fs.readFile(setupCompletedPath(), "utf8"));
    expect(done.adminEmail).toBe("a@b.com");
  });

  test("TTL constant is 10 minutes", () => {
    expect(SETUP_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
  });

  test("deleteSetupToken is idempotent", async () => {
    await deleteSetupToken();
    await createSetupToken();
    await deleteSetupToken();
    await deleteSetupToken();
  });
});
