import fs from "fs/promises";
import path from "path";
import { MissingLicenseException } from "./exceptions/MissingLicenseException.js";
import { InvalidLicenseException } from "./exceptions/InvalidLicenseException.js";

/**
 * Locates and reads the license container from configured search locations.
 * Priority: relative search paths, then environment path / content.
 */
export class LicenseLoader {
  /**
   * @param {object} config
   * @param {string} config.appRoot
   * @param {string[]} config.searchPaths Relative paths under appRoot
   * @param {string} [config.envFilePath] Absolute/relative path from LICENSE_PATH
   * @param {string} [config.envContent] Raw JSON from LICENSE_CONTENT
   */
  constructor(config) {
    this.appRoot = config.appRoot;
    this.searchPaths = config.searchPaths || [];
    this.envFilePath = config.envFilePath || null;
    this.envContent = config.envContent || null;
  }

  /**
   * @returns {Promise<{ container: object, source: string, raw: string }>}
   */
  async load() {
    const candidates = this.#buildCandidates();

    for (const candidate of candidates) {
      if (candidate.kind === "content") {
        return this.#parseRaw(candidate.value, candidate.source);
      }

      const absolutePath = path.isAbsolute(candidate.value)
        ? candidate.value
        : path.resolve(this.appRoot, candidate.value);

      try {
        await fs.access(absolutePath);
      } catch {
        continue;
      }

      let raw;
      try {
        raw = await fs.readFile(absolutePath, "utf8");
      } catch (err) {
        throw new InvalidLicenseException(
          `Unable to read license file at ${absolutePath}: ${err.message}`,
        );
      }

      return this.#parseRaw(raw, absolutePath);
    }

    throw new MissingLicenseException(
      `License not found. Searched: ${candidates.map((c) => c.source).join(", ")}`,
    );
  }

  #buildCandidates() {
    const candidates = [];

    // Prefer explicit ProgramData / LICENSE_PATH before relative app-root paths.
    if (this.envFilePath && String(this.envFilePath).trim()) {
      candidates.push({
        kind: "file",
        value: String(this.envFilePath).trim(),
        source: `env:LICENSE_PATH`,
      });
    }

    for (const relative of this.searchPaths) {
      const value = String(relative).trim();
      if (!value) continue;
      const absolute = path.isAbsolute(value) ? value : path.join(this.appRoot, value);
      // Skip duplicates of envFilePath
      if (
        this.envFilePath &&
        path.resolve(absolute) ===
          path.resolve(
            path.isAbsolute(this.envFilePath)
              ? this.envFilePath
              : path.join(this.appRoot, this.envFilePath),
          )
      ) {
        continue;
      }
      candidates.push({
        kind: "file",
        value,
        source: absolute,
      });
    }

    if (this.envContent && String(this.envContent).trim()) {
      candidates.push({
        kind: "content",
        value: String(this.envContent).trim(),
        source: "env:LICENSE_CONTENT",
      });
    }

    return candidates;
  }

  #parseRaw(raw, source) {
    if (!raw || !String(raw).trim()) {
      throw new InvalidLicenseException(`License file is empty (${source})`);
    }

    let container;
    try {
      container = JSON.parse(raw);
    } catch {
      throw new InvalidLicenseException(`License JSON is corrupted or malformed (${source})`);
    }

    if (!container || typeof container !== "object" || Array.isArray(container)) {
      throw new InvalidLicenseException(`License container must be a JSON object (${source})`);
    }

    return { container, source, raw: String(raw) };
  }
}
