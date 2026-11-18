import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238, the 6-digit codes every authenticator
 * app shows), written against Node's own crypto so there is no dependency to
 * trust for the second factor.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding: what authenticator apps expect in a secret. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 160 random bits, as RFC 4226 recommends. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in. */
export function totpStep(at: number = Date.now()): number {
  return Math.floor(at / 1000 / STEP_SECONDS);
}

/** The code for one step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The step a code belongs to, allowing one step either side for a phone whose
 * clock has drifted; null when it matches none. Compared in constant time.
 */
export function matchTotp(secret: string, code: string, at: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(at);
  let found: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) found = step;
  }
  return found;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Ten recovery codes, each 10 characters in two groups ("k7f2m-9qx4c"), from
 * an alphabet without look-alike characters.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** How a recovery code is stored and compared: hashed, without its dash or case. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256")
    .update(code.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .digest("hex");
}
