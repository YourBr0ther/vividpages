import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { getEnv } from './env';

/**
 * Symmetric encryption for at-rest secrets (user API keys).
 *
 * Algorithm: AES-256-GCM (authenticated encryption). The 32-byte key comes
 * from ENCRYPTION_KEY (64 lowercase hex chars, validated in env.ts).
 *
 * Payload format: base64 of the byte concatenation
 *
 *     iv (12 bytes) || authTag (16 bytes) || ciphertext (N bytes)
 *
 * The IV is random per call, so encrypting the same plaintext twice yields
 * different payloads. GCM's auth tag makes tampering (with either the IV,
 * the tag, or the ciphertext) fail closed at decrypt time, and decrypting
 * with the wrong key likewise throws.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The 32-byte AES key derived from the validated hex ENCRYPTION_KEY. */
function key(): Buffer {
  // env.ts guarantees ENCRYPTION_KEY is exactly 64 hex chars → 32 bytes.
  return Buffer.from(getEnv().ENCRYPTION_KEY, 'hex');
}

/** Encrypts `plaintext` and returns a base64 payload (iv || tag || ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypts a base64 payload produced by {@link encryptSecret}. Throws on
 * malformed input, a wrong key, or any tampering (GCM tag mismatch).
 */
export function decryptSecret(payload: string): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('decryptSecret: payload must be a non-empty base64 string');
  }
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('decryptSecret: payload too short to contain iv + auth tag');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  // .final() throws if the auth tag doesn't verify (wrong key or tampering).
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Last 4 characters of a secret, for masked display (e.g. `sk-…1a2b`). */
export function lastFour(plaintext: string): string {
  return plaintext.slice(-4);
}
