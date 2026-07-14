import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Server-only symmetric encryption for social-connection tokens at rest.
 *
 * Tokens (TikTok/YouTube/etc. refresh + access tokens) are encrypted with
 * AES-256-GCM before being stored in the `social_connections` table, and
 * decrypted only inside internal, shared-secret-authed endpoints. The key
 * comes from the `CONNECTION_TOKEN_KEY` env var (set the SAME value on the
 * Hub and any app that stores/reads connection tokens).
 *
 * Format of the stored string: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
 * The `v1:` prefix lets us rotate the scheme later without ambiguity.
 */

const SCHEME = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

/**
 * Derive a stable 32-byte key from whatever the operator put in
 * CONNECTION_TOKEN_KEY. Accepting an arbitrary string (passphrase, base64, or
 * hex) and SHA-256'ing it means any sufficiently-random value works without
 * forcing an exact byte length — simpler to operate, still 256-bit.
 */
function getKey(): Buffer {
  const raw = process.env.CONNECTION_TOKEN_KEY?.trim();
  if (!raw || raw.length < 16) {
    throw new Error(
      "CONNECTION_TOKEN_KEY is not set (or too short). Add a long random value in Coolify env.",
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt a plaintext token. Returns the `v1:…` envelope string. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Decrypt a `v1:…` envelope string produced by encryptToken. */
export function decryptToken(envelope: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new Error("Malformed encrypted token envelope.");
  }
  const key = getKey();
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const ciphertext = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** True when CONNECTION_TOKEN_KEY is configured (no secret material leaked). */
export function isConnectionCryptoConfigured(): boolean {
  const raw = process.env.CONNECTION_TOKEN_KEY?.trim();
  return Boolean(raw && raw.length >= 16);
}
