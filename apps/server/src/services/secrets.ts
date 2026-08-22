import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encryption for secrets kept in the database — today, model API keys.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than yielding garbage. Every value gets a fresh IV. The stored form is
 * versioned so the scheme can change without guessing at old rows.
 */
const FORMAT = "v1";
const IV_BYTES = 12;

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error(`Encryption key must be 32 bytes, got ${key.length}`);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  /**
   * Returns null rather than throwing when a value cannot be read — a rotated
   * or lost key should degrade to "no key configured", not crash every request
   * that touches settings.
   */
  decrypt(stored: string): string | null {
    try {
      const [format, iv, tag, ciphertext] = stored.split(".");
      if (format !== FORMAT || !iv || !tag || !ciphertext) return null;

      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }
}

/**
 * Resolves the master key.
 *
 * `ZELYQ_SECRET_KEY` wins, which is what a real deployment should set so the
 * key lives in a secret manager rather than on the disk it protects. Otherwise
 * one is generated and written beside the database with owner-only permissions,
 * so a laptop install needs no setup — at the cost of key and ciphertext living
 * together, which is stated in the docs rather than hidden.
 *
 * Losing the key does not lose the instance: stored API keys become unreadable
 * and are re-entered.
 */
export function resolveSecretKey(options: {
  envKey: string | undefined;
  keyFilePath: string;
  onGenerate?: (path: string) => void;
}): Buffer {
  if (options.envKey) {
    const decoded = decodeKey(options.envKey);
    if (!decoded) {
      throw new Error("ZELYQ_SECRET_KEY must be 32 bytes, encoded as base64 or 64 hex characters.");
    }
    return decoded;
  }

  if (fs.existsSync(options.keyFilePath)) {
    const decoded = decodeKey(fs.readFileSync(options.keyFilePath, "utf8").trim());
    if (decoded) return decoded;
  }

  const generated = randomBytes(32);
  fs.mkdirSync(path.dirname(options.keyFilePath), { recursive: true });
  fs.writeFileSync(options.keyFilePath, generated.toString("base64"), { mode: 0o600 });
  options.onGenerate?.(options.keyFilePath);
  return generated;
}

function decodeKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 ? decoded : null;
}

/** Shows enough of a stored secret to recognise it, never enough to use it. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}
