import { Client } from 'minio';
import * as dotenv from 'dotenv';

dotenv.config();

// MinIO client configuration
export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'vividpages';

/**
 * Ensure the bucket exists, create if it doesn't
 */
export async function ensureBucket(): Promise<void> {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);

    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
      console.log(`✅ Created MinIO bucket: ${BUCKET_NAME}`);
    } else {
      console.log(`✅ MinIO bucket exists: ${BUCKET_NAME}`);
    }
  } catch (error) {
    console.error('❌ Error ensuring MinIO bucket:', error);
    throw error;
  }
}

/**
 * Upload a file to MinIO
 */
export async function uploadFile(
  objectName: string,
  filePath: string,
  metadata: Record<string, string> = {}
): Promise<string> {
  try {
    await minioClient.fPutObject(BUCKET_NAME, objectName, filePath, metadata);
    console.log(`✅ Uploaded file to MinIO: ${objectName}`);
    return objectName;
  } catch (error) {
    console.error('❌ Error uploading file to MinIO:', error);
    throw error;
  }
}

/**
 * Upload a buffer to MinIO
 */
export async function uploadBuffer(
  objectName: string,
  buffer: Buffer,
  size: number,
  metadata: Record<string, string> = {}
): Promise<string> {
  try {
    await minioClient.putObject(BUCKET_NAME, objectName, buffer, size, metadata);
    console.log(`✅ Uploaded buffer to MinIO: ${objectName}`);
    return objectName;
  } catch (error) {
    console.error('❌ Error uploading buffer to MinIO:', error);
    throw error;
  }
}

/**
 * Download a file from MinIO
 */
export async function downloadFile(objectName: string, filePath: string): Promise<void> {
  try {
    await minioClient.fGetObject(BUCKET_NAME, objectName, filePath);
    console.log(`✅ Downloaded file from MinIO: ${objectName}`);
  } catch (error) {
    console.error('❌ Error downloading file from MinIO:', error);
    throw error;
  }
}

/**
 * Get a file stream from MinIO
 */
export async function getFileStream(objectName: string): Promise<NodeJS.ReadableStream> {
  try {
    const stream = await minioClient.getObject(BUCKET_NAME, objectName);
    return stream;
  } catch (error) {
    console.error('❌ Error getting file stream from MinIO:', error);
    throw error;
  }
}

/**
 * Get file stats from MinIO
 */
export async function getFileStat(objectName: string) {
  try {
    const stat = await minioClient.statObject(BUCKET_NAME, objectName);
    return stat;
  } catch (error) {
    console.error('❌ Error getting file stat from MinIO:', error);
    throw error;
  }
}

/**
 * Delete a file from MinIO
 */
export async function deleteFile(objectName: string): Promise<void> {
  try {
    await minioClient.removeObject(BUCKET_NAME, objectName);
    console.log(`✅ Deleted file from MinIO: ${objectName}`);
  } catch (error) {
    console.error('❌ Error deleting file from MinIO:', error);
    throw error;
  }
}

/**
 * Generate a presigned URL for temporary access
 */
export async function getPresignedUrl(
  objectName: string,
  expirySeconds: number = 3600
): Promise<string> {
  try {
    const url = await minioClient.presignedGetObject(BUCKET_NAME, objectName, expirySeconds);
    return url;
  } catch (error) {
    console.error('❌ Error generating presigned URL:', error);
    throw error;
  }
}

/**
 * List objects in bucket with prefix
 */
export async function listObjects(prefix: string = ''): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const objects: string[] = [];
    const stream = minioClient.listObjects(BUCKET_NAME, prefix, true);

    stream.on('data', (obj) => {
      if (obj.name) {
        objects.push(obj.name);
      }
    });

    stream.on('error', (err) => {
      reject(err);
    });

    stream.on('end', () => {
      resolve(objects);
    });
  });
}

export { BUCKET_NAME };
