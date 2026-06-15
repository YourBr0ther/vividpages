import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, lastFour } from '../src/crypto';
import { resetEnvForTests } from '../src/env';

/**
 * crypto reads ENCRYPTION_KEY via getEnv(), so these tests set process.env
 * directly (no dotenv) and reset the cached env per test.
 */
const ORIGINAL_ENV = process.env;

/** Two distinct valid 64-hex (32-byte) keys. */
const KEY_A = 'ab'.repeat(32);
const KEY_B = 'cd'.repeat(32);

function envWithKey(key: string): void {
  process.env = {
    DATABASE_URL: 'postgres://vividpages:vividpages@localhost:5432/vividpages',
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'vividpages',
    MINIO_SECRET_KEY: 'vividpages123',
    AUTH_SECRET: 'a-secret-that-is-long-enough',
    ENCRYPTION_KEY: key,
  } as NodeJS.ProcessEnv;
  resetEnvForTests();
}

beforeEach(() => {
  envWithKey(KEY_A);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  resetEnvForTests();
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext secret', () => {
    const plaintext = 'sk-ant-abc123-super-secret';
    const payload = encryptSecret(plaintext);
    expect(payload).not.toContain(plaintext);
    expect(decryptSecret(payload)).toBe(plaintext);
  });

  it('round-trips empty and unicode strings', () => {
    for (const plaintext of ['', 'sk-🔑-key-with-émojis-✨']) {
      expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
    }
  });

  it('uses a distinct IV per call (two encrypts of same plaintext differ)', () => {
    const plaintext = 'sk-openai-identical-input';
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    // Both still decrypt back to the same plaintext.
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it('throws when the ciphertext is tampered with', () => {
    const payload = encryptSecret('sk-tamper-me');
    const raw = Buffer.from(payload, 'base64');
    // Flip the last byte (within the ciphertext region) so the GCM auth tag
    // no longer matches.
    const last = raw.length - 1;
    raw.writeUInt8(raw.readUInt8(last) ^ 0xff, last);
    const tampered = raw.toString('base64');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws when the auth tag is tampered with', () => {
    const payload = encryptSecret('sk-tamper-tag');
    const raw = Buffer.from(payload, 'base64');
    // The auth tag lives at bytes 12..28 (after the 12-byte IV).
    raw.writeUInt8(raw.readUInt8(13) ^ 0xff, 13);
    expect(() => decryptSecret(raw.toString('base64'))).toThrow();
  });

  it('throws when decrypting with the wrong key', () => {
    const payload = encryptSecret('sk-wrong-key-test');
    envWithKey(KEY_B);
    expect(() => decryptSecret(payload)).toThrow();
  });

  it('throws on malformed (non-base64 / too-short) input', () => {
    expect(() => decryptSecret('')).toThrow();
    expect(() => decryptSecret('not-valid!!!')).toThrow();
    // Valid base64 but far too short to hold iv + tag.
    expect(() => decryptSecret(Buffer.from('short').toString('base64'))).toThrow();
  });
});

describe('lastFour', () => {
  it('returns the last 4 characters', () => {
    expect(lastFour('sk-ant-api03-deadbeef1a2b')).toBe('1a2b');
  });

  it('returns the whole string when shorter than 4', () => {
    expect(lastFour('ab')).toBe('ab');
    expect(lastFour('')).toBe('');
  });
});
