import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../src/env';
import {
  closeStorage,
  ensureBuckets,
  getObject,
  getObjectStream,
  getS3Client,
  presignGetUrl,
  putObject,
} from '../src/storage';

/**
 * Integration test against a live MinIO (the local compose stack). Skipped
 * unless MINIO_ENDPOINT is set. Run with:
 *
 *   MINIO_ENDPOINT=http://localhost:9000 \
 *   MINIO_ACCESS_KEY=vividpages \
 *   MINIO_SECRET_KEY=vividpages123 \
 *   pnpm -F @vividpages/core test
 *
 * Env vars are read straight from process.env (no dotenv); the unrelated
 * required vars are stubbed below since getEnv() validates the whole schema.
 */
describe.skipIf(!process.env.MINIO_ENDPOINT)('storage (MinIO integration)', () => {
  const key = `integration-test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const body = `vividpages storage roundtrip ${new Date().toISOString()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused';
    process.env.AUTH_SECRET ??= 'storage-integration-test-secret';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
    resetEnvForTests();
    await ensureBuckets();
  });

  afterAll(async () => {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: 'epubs', Key: key }));
    closeStorage();
    resetEnvForTests();
  });

  it('ensureBuckets is idempotent', async () => {
    // Buckets were created in beforeAll; a second call must not throw.
    await expect(ensureBuckets()).resolves.toBeUndefined();
  });

  it('roundtrips put -> get', async () => {
    await putObject('epubs', key, body, 'text/plain');
    const fetched = await getObject('epubs', key);
    expect(fetched.toString('utf8')).toBe(body);
  });

  it('streams an object', async () => {
    const stream = await getObjectStream('epubs', key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe(body);
  });

  it('presigns a GET url that works without credentials', async () => {
    const url = await presignGetUrl('epubs', key, 60);
    expect(url).toContain('X-Amz-Signature');
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
  });
});
