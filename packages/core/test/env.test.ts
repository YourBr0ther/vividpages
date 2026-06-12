import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTests } from '../src/env';

/**
 * getEnv() reads process.env directly (no dotenv), so these tests manipulate
 * process.env per test and restore it afterwards.
 */

const ORIGINAL_ENV = process.env;

/** A minimal valid set of required vars. */
function validEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgres://vividpages:vividpages@localhost:5432/vividpages',
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_ACCESS_KEY: 'vividpages',
    MINIO_SECRET_KEY: 'vividpages123',
    AUTH_SECRET: 'a-secret-that-is-long-enough',
    ENCRYPTION_KEY: 'ab'.repeat(32),
  };
}

beforeEach(() => {
  process.env = {} as NodeJS.ProcessEnv;
  resetEnvForTests();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  resetEnvForTests();
});

describe('getEnv', () => {
  it('returns a typed object on the happy path', () => {
    Object.assign(process.env, validEnv());
    const env = getEnv();
    expect(env.DATABASE_URL).toBe('postgres://vividpages:vividpages@localhost:5432/vividpages');
    expect(env.MINIO_ENDPOINT).toBe('http://localhost:9000');
    expect(env.MINIO_ACCESS_KEY).toBe('vividpages');
    expect(env.MINIO_SECRET_KEY).toBe('vividpages123');
    expect(env.AUTH_SECRET).toBe('a-secret-that-is-long-enough');
    expect(env.ENCRYPTION_KEY).toBe('ab'.repeat(32));
  });

  it('applies defaults for optional vars', () => {
    Object.assign(process.env, validEnv());
    const env = getEnv();
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.OLLAMA_URL).toBe('http://10.0.2.192:11434');
    expect(env.COMFYUI_URL).toBe('http://10.0.2.192:8188');
    expect(env.WORKER_CONCURRENCY_INGEST).toBe(2);
    expect(env.WORKER_CONCURRENCY_SEGMENT).toBe(2);
    expect(env.WORKER_CONCURRENCY_ANALYZE).toBe(1);
    expect(env.WORKER_CONCURRENCY_PROFILES).toBe(1);
    expect(env.WORKER_CONCURRENCY_IMAGINE).toBe(1);
  });

  it('coerces worker concurrency overrides to integers', () => {
    Object.assign(process.env, validEnv(), { WORKER_CONCURRENCY_INGEST: '5' });
    expect(getEnv().WORKER_CONCURRENCY_INGEST).toBe(5);
  });

  it('names a missing required var in the error message', () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    Object.assign(process.env, env);
    expect(() => getEnv()).toThrowError(/DATABASE_URL/);
  });

  it('lists every missing/invalid var in one error', () => {
    const env = validEnv();
    delete (env as Record<string, string | undefined>).DATABASE_URL;
    delete (env as Record<string, string | undefined>).MINIO_ENDPOINT;
    env.AUTH_SECRET = 'short';
    Object.assign(process.env, env);
    let message = '';
    try {
      getEnv();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/MINIO_ENDPOINT/);
    expect(message).toMatch(/AUTH_SECRET/);
  });

  it('treats empty strings as missing', () => {
    const env = validEnv();
    env.AUTH_SECRET = '';
    Object.assign(process.env, env);
    expect(() => getEnv()).toThrowError(/AUTH_SECRET/);
  });

  it('rejects an invalid ENCRYPTION_KEY format', () => {
    Object.assign(process.env, validEnv(), { ENCRYPTION_KEY: 'not-hex' });
    expect(() => getEnv()).toThrowError(/ENCRYPTION_KEY/);

    resetEnvForTests();
    // uppercase hex is also invalid (must match /^[0-9a-f]{64}$/)
    Object.assign(process.env, validEnv(), { ENCRYPTION_KEY: 'AB'.repeat(32) });
    expect(() => getEnv()).toThrowError(/ENCRYPTION_KEY/);
  });

  it('rejects a non-URL DATABASE_URL', () => {
    Object.assign(process.env, validEnv(), { DATABASE_URL: 'not a url' });
    expect(() => getEnv()).toThrowError(/DATABASE_URL/);
  });

  it('caches the parsed env until resetEnvForTests()', () => {
    Object.assign(process.env, validEnv());
    const first = getEnv();
    process.env.AUTH_SECRET = 'a-different-secret-value';
    expect(getEnv()).toBe(first);

    resetEnvForTests();
    expect(getEnv().AUTH_SECRET).toBe('a-different-secret-value');
  });
});
