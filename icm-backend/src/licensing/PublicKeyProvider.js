import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { InvalidLicenseException } from "./exceptions/InvalidLicenseException.js";
import { PublicKeyNotFoundException } from "./exceptions/PublicKeyNotFoundException.js";

/**
 * Loads RSA public keys by kid.
 * Resolution order (LMS-compatible):
 *   1. {keysDir}/{kid}/public.pem
 *   2. {keysDir}/{kid}.pub          (Identity Sphere convenience)
 *   3. {keysDir}/public.pem         (legacy flat layout)
 */
export class PublicKeyProvider {
  /**
   * @param {object} config
   * @param {string} config.keysDir
   */
  constructor(config) {
    this.keysDir = config.keysDir;
    /** @type {Map<string, crypto.KeyObject>} */
    this.#cache = new Map();
  }

  #cache;

  /**
   * @param {string} kid
   * @returns {Promise<crypto.KeyObject>}
   */
  async getPublicKey(kid) {
    if (!kid || typeof kid !== "string" || !kid.trim()) {
      throw new InvalidLicenseException("License kid is missing or invalid");
    }

    const normalizedKid = kid.trim();

    if (!/^[A-Za-z0-9._-]+$/.test(normalizedKid)) {
      throw new InvalidLicenseException(`License kid contains invalid characters: ${normalizedKid}`);
    }

    if (this.#cache.has(normalizedKid)) {
      return this.#cache.get(normalizedKid);
    }

    const candidates = [
      path.join(this.keysDir, normalizedKid, "public.pem"),
      path.join(this.keysDir, `${normalizedKid}.pub`),
      path.join(this.keysDir, "public.pem"),
    ];

    let pem = null;
    let usedPath = null;
    for (const keyPath of candidates) {
      try {
        pem = await fs.readFile(keyPath, "utf8");
        usedPath = keyPath;
        break;
      } catch {
        // try next
      }
    }

    if (!pem) {
      throw new PublicKeyNotFoundException(
        `Public key not found for kid "${normalizedKid}" under ${this.keysDir}`,
      );
    }

    if (!pem.includes("PUBLIC KEY")) {
      throw new PublicKeyNotFoundException(
        `Public key file for kid "${normalizedKid}" is missing or not a PEM public key (${usedPath})`,
      );
    }

    let keyObject;
    try {
      keyObject = crypto.createPublicKey(pem);
    } catch (err) {
      throw new PublicKeyNotFoundException(
        `Failed to parse public key for kid "${normalizedKid}": ${err.message}`,
      );
    }

    this.#cache.set(normalizedKid, keyObject);
    return keyObject;
  }

  clearCache() {
    this.#cache.clear();
  }
}
