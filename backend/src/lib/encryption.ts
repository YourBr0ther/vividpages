import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is not set');
}

// Convert hex string to Buffer (ENCRYPTION_KEY is 64 hex chars = 32 bytes)
const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');

if (keyBuffer.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
}

// ============================================
// Encryption/Decryption Types
// ============================================

export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

// ============================================
// API Key Encryption
// ============================================

/**
 * Encrypt an API key using AES-256-GCM
 * Returns an object with encrypted data, IV, and auth tag
 */
export function encryptAPIKey(plainKey: string): EncryptedData {
  // Generate random initialization vector (16 bytes for AES)
  const iv = crypto.randomBytes(16);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  // Encrypt the key
  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt an encrypted API key
 * Returns the plain text API key
 */
export function decryptAPIKey(encryptedData: EncryptedData): string {
  try {
    // Create decipher
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      keyBuffer,
      Buffer.from(encryptedData.iv, 'hex')
    );

    // Set auth tag
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    // Decrypt
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt API key - data may be corrupted or tampered with');
  }
}

/**
 * Helper to serialize encrypted data to JSON string for database storage
 */
export function serializeEncryptedData(encryptedData: EncryptedData): string {
  return JSON.stringify(encryptedData);
}

/**
 * Helper to deserialize encrypted data from JSON string
 */
export function deserializeEncryptedData(jsonString: string): EncryptedData {
  try {
    const data = JSON.parse(jsonString);

    if (!data.encrypted || !data.iv || !data.authTag) {
      throw new Error('Invalid encrypted data format');
    }

    return data as EncryptedData;
  } catch (error) {
    throw new Error('Failed to deserialize encrypted data');
  }
}
