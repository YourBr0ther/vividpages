import type { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getEnv } from './env';

/** Buckets the pipeline expects to exist. */
export const BUCKETS = ['epubs', 'images', 'covers'] as const;
export type Bucket = (typeof BUCKETS)[number];

let client: S3Client | undefined;

/** Lazy singleton S3 client pointed at MinIO (path-style addressing). */
export function getS3Client(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      endpoint: env.MINIO_ENDPOINT,
      forcePathStyle: true,
      // MinIO ignores the region but the SDK requires one.
      region: 'us-east-1',
      credentials: {
        accessKeyId: env.MINIO_ACCESS_KEY,
        secretAccessKey: env.MINIO_SECRET_KEY,
      },
    });
  }
  return client;
}

export async function putObject(
  bucket: Bucket,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(bucket: Bucket, key: string): Promise<Buffer> {
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`storage: empty body for s3://${bucket}/${key}`);
  }
  return Buffer.from(await response.Body.transformToByteArray());
}

/** Deletes an object; S3 semantics make this a no-op if the key is absent. */
export async function deleteObject(bucket: Bucket, key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getObjectStream(bucket: Bucket, key: string): Promise<Readable> {
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`storage: empty body for s3://${bucket}/${key}`);
  }
  // In Node the SDK always returns a Readable stream.
  return response.Body as Readable;
}

export async function presignGetUrl(
  bucket: Bucket,
  key: string,
  expiresSeconds = 3600,
): Promise<string> {
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresSeconds,
  });
}

/** Creates all required buckets, ignoring ones that already exist. */
export async function ensureBuckets(): Promise<void> {
  const s3 = getS3Client();
  for (const bucket of BUCKETS) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
        throw err;
      }
    }
  }
}

/** Destroys the singleton client (used by worker shutdown and tests). */
export function closeStorage(): void {
  client?.destroy();
  client = undefined;
}
