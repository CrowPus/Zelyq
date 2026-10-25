import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pluginSignaturePayload } from "@zelyq/core";

/**
 * The registry's signing key: Ed25519, created on first start in the data
 * folder (readable only by this user) and never leaving this server. Zelyq
 * carries the public half and installs nothing it does not verify.
 */
export interface Signer {
  /** Short id of the public key, so a key can be replaced without guessing. */
  keyId: string;
  /** The public key, SPKI DER base64 — what Zelyq is given. */
  publicKey: string;
  sign(id: string, version: string, sha256: string): string;
}

export function loadSigner(dataDir: string): Signer {
  const file = path.join(dataDir, "signing-key.pem");
  let privateKey: KeyObject;
  if (existsSync(file)) {
    privateKey = createPrivateKey(readFileSync(file));
  } else {
    privateKey = generateKeyPairSync("ed25519").privateKey;
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const der = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return {
    keyId: createHash("sha256").update(der).digest("hex").slice(0, 16),
    publicKey: der.toString("base64"),
    sign: (id, version, sha256) =>
      sign(null, Buffer.from(pluginSignaturePayload(id, version, sha256)), privateKey).toString(
        "base64",
      ),
  };
}
