import fs from "fs";
import os from "os";
import path from "path";
import {
  loadProductionConfigFile,
  writeProductionConfig,
} from "../config/productionConfig.js";
import { ensureJwtSecret } from "../config/secretsBootstrap.js";
import { readVersionMetadata, writeVersionMetadata } from "../config/versionMetadata.js";

describe("production config manager", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "is-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("validates and loads config.json", () => {
    const configPath = path.join(tmp, "config.json");
    writeProductionConfig(configPath, {
      server: { port: 9090, host: "127.0.0.1" },
      database: { uri: "mongodb://127.0.0.1:27017", name: "IGA-V3" },
      paths: {},
      security: { jwtSecret: "" },
      deployment: {
        mode: "public",
        publicUrl: "https://iga.example.com",
        requireMfa: true,
      },
      cors: { origins: ["https://iga.example.com"] },
    });
    const loaded = loadProductionConfigFile(configPath);
    expect(loaded.config.server.port).toBe(9090);
    expect(loaded.config.database.name).toBe("IGA-V3");
    expect(loaded.config.deployment).toEqual({
      mode: "public",
      publicUrl: "https://iga.example.com",
      requireMfa: true,
      iamTeamEmail: "",
    });
    expect(loaded.config.cors.origins).toEqual(["https://iga.example.com"]);
  });

  test("accepts leftover installer security keys without failing boot", () => {
    const configPath = path.join(tmp, "config.json");
    writeProductionConfig(configPath, {
      server: { port: 8081, host: "127.0.0.1" },
      database: { uri: "mongodb://127.0.0.1:27018", name: "IGA-V3" },
      security: {
        jwtSecret: "",
        setupMode: true,
        adminEmail: "admin@example.com",
        adminFirstName: "System",
        adminLastName: "Admin",
        deferAdminSeed: true,
      },
    });
    const loaded = loadProductionConfigFile(configPath);
    expect(loaded.config.security.setupMode).toBe(true);
    expect(loaded.config.security.adminEmail).toBe("admin@example.com");
  });

  test("accepts leftover installer security keys without failing boot", () => {
    const configPath = path.join(tmp, "config.json");
    writeProductionConfig(configPath, {
      server: { port: 8081, host: "127.0.0.1" },
      database: { uri: "mongodb://127.0.0.1:27018", name: "IGA-V3" },
      security: {
        jwtSecret: "",
        setupMode: true,
        adminEmail: "admin@example.com",
        adminFirstName: "System",
        adminLastName: "Admin",
        deferAdminSeed: true,
      },
    });
    const loaded = loadProductionConfigFile(configPath);
    expect(loaded.config.security.setupMode).toBe(true);
    expect(loaded.config.security.adminEmail).toBe("admin@example.com");
  });

  test("rejects unsupported deployment modes", () => {
    const configPath = path.join(tmp, "config.json");
    writeProductionConfig(configPath, {
      server: { port: 9090, host: "127.0.0.1" },
      database: { uri: "mongodb://127.0.0.1:27017", name: "IGA-V3" },
      deployment: { mode: "unknown", publicUrl: "https://iga.example.com" },
    });
    expect(() => loadProductionConfigFile(configPath)).toThrow(
      /deployment\.mode/,
    );
  });

  test("generates jwt secret when missing", () => {
    const configPath = path.join(tmp, "config.json");
    const config = {
      server: { port: 8081 },
      database: { uri: "mongodb://127.0.0.1:27017", name: "IGA-V3" },
      security: { jwtSecret: "" },
    };
    writeProductionConfig(configPath, config);
    const secret = ensureJwtSecret(configPath, config);
    expect(secret.length).toBeGreaterThan(20);
    const reloaded = loadProductionConfigFile(configPath);
    expect(reloaded.config.security.jwtSecret).toBe(secret);
  });

  test("version.json round-trip", () => {
    const versionPath = path.join(tmp, "version.json");
    writeVersionMetadata(versionPath, { productVersion: "1.0.0", schemaVersion: 1 });
    const v = readVersionMetadata(versionPath);
    expect(v.productVersion).toBe("1.0.0");
    expect(v.schemaVersion).toBe(1);
  });
});
