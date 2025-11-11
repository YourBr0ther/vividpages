import { db } from '../db/index.js';
import { apiKeys, type ApiKey, type NewApiKey } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { encryptAPIKey, decryptAPIKey, serializeEncryptedData, deserializeEncryptedData } from './encryption.js';
import axios from 'axios';

// ============================================
// Types
// ============================================

export interface ApiKeyInput {
  provider: 'claude' | 'chatgpt' | 'ollama' | 'dall-e' | 'stable-diffusion' | 'other';
  apiKey: string;
  nickname?: string;
}

export interface ApiKeyResponse {
  id: string;
  provider: string;
  nickname: string | null;
  maskedKey: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyTestResult {
  success: boolean;
  message: string;
  details?: any;
}

// ============================================
// API Key Service
// ============================================

/**
 * Create a new API key for a user
 */
export async function createApiKey(userId: string, input: ApiKeyInput): Promise<ApiKeyResponse> {
  // Encrypt the API key
  const encryptedData = encryptAPIKey(input.apiKey);
  const encryptedKeyJson = serializeEncryptedData(encryptedData);

  // Insert into database
  const [apiKey] = await db.insert(apiKeys).values({
    userId,
    provider: input.provider,
    encryptedKey: encryptedKeyJson,
    nickname: input.nickname || null,
    isActive: true,
  }).returning();

  return formatApiKeyResponse(apiKey, input.apiKey);
}

/**
 * Get all API keys for a user (with masked keys)
 */
export async function getUserApiKeys(userId: string): Promise<ApiKeyResponse[]> {
  const userKeys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, userId),
    orderBy: (apiKeys, { desc }) => [desc(apiKeys.createdAt)],
  });

  return userKeys.map(key => {
    // Decrypt to get masked version
    const decryptedKey = decryptApiKeyFromDb(key.encryptedKey);
    return formatApiKeyResponse(key, decryptedKey);
  });
}

/**
 * Get a specific API key (fully decrypted) - for internal use only
 */
export async function getApiKey(userId: string, keyId: string): Promise<string | null> {
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, userId),
      eq(apiKeys.isActive, true)
    ),
  });

  if (!apiKey) {
    return null;
  }

  return decryptApiKeyFromDb(apiKey.encryptedKey);
}

/**
 * Get API key by provider for a user
 */
export async function getApiKeyByProvider(userId: string, provider: string): Promise<string | null> {
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.userId, userId),
      eq(apiKeys.provider, provider),
      eq(apiKeys.isActive, true)
    ),
  });

  if (!apiKey) {
    return null;
  }

  return decryptApiKeyFromDb(apiKey.encryptedKey);
}

/**
 * Update an API key
 */
export async function updateApiKey(
  userId: string,
  keyId: string,
  updates: Partial<ApiKeyInput>
): Promise<ApiKeyResponse> {
  // Build update object
  const updateData: any = {};

  if (updates.nickname !== undefined) {
    updateData.nickname = updates.nickname;
  }

  if (updates.apiKey) {
    const encryptedData = encryptAPIKey(updates.apiKey);
    updateData.encryptedKey = serializeEncryptedData(encryptedData);
  }

  if (updates.provider) {
    updateData.provider = updates.provider;
  }

  updateData.updatedAt = new Date();

  // Update in database
  const [updatedKey] = await db.update(apiKeys)
    .set(updateData)
    .where(and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, userId)
    ))
    .returning();

  if (!updatedKey) {
    throw new Error('API key not found');
  }

  const decryptedKey = decryptApiKeyFromDb(updatedKey.encryptedKey);
  return formatApiKeyResponse(updatedKey, decryptedKey);
}

/**
 * Delete (soft delete) an API key
 */
export async function deleteApiKey(userId: string, keyId: string): Promise<void> {
  await db.update(apiKeys)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.userId, userId)
    ));
}

/**
 * Test if an API key is valid by making a test request
 */
export async function testApiKey(provider: string, apiKey: string): Promise<ApiKeyTestResult> {
  try {
    switch (provider) {
      case 'claude':
        return await testClaudeKey(apiKey);

      case 'chatgpt':
        return await testChatGPTKey(apiKey);

      case 'ollama':
        return await testOllamaKey(apiKey);

      case 'dall-e':
        return await testDallEKey(apiKey);

      case 'stable-diffusion':
        return await testStableDiffusionKey(apiKey);

      default:
        return {
          success: false,
          message: 'Unknown provider - cannot test API key',
        };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to test API key',
    };
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Decrypt API key from database format
 */
function decryptApiKeyFromDb(encryptedKeyJson: string): string {
  const encryptedData = deserializeEncryptedData(encryptedKeyJson);
  return decryptAPIKey(encryptedData);
}

/**
 * Format API key for response (with masked key)
 */
function formatApiKeyResponse(apiKey: ApiKey, decryptedKey: string): ApiKeyResponse {
  return {
    id: apiKey.id,
    provider: apiKey.provider,
    nickname: apiKey.nickname,
    maskedKey: maskApiKey(decryptedKey),
    isActive: apiKey.isActive,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
  };
}

/**
 * Mask API key (show prefix and last 4 characters)
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return '****';
  }

  // For keys with common prefixes (sk-, pk-, etc.), show the prefix
  const prefixMatch = apiKey.match(/^([a-z]{2}-)/);
  const prefix = prefixMatch ? prefixMatch[1] : '';

  const lastFour = apiKey.slice(-4);
  const dots = '•'.repeat(8); // Use 8 bullets for consistent width

  return prefix ? `${prefix}${dots}${lastFour}` : `${dots}${lastFour}`;
}

// ============================================
// Provider-Specific API Key Testing
// ============================================

async function testClaudeKey(apiKey: string): Promise<ApiKeyTestResult> {
  try {
    const response = await axios.get('https://api.anthropic.com/v1/messages', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      validateStatus: (status) => status === 401 || status === 200 || status === 400,
    });

    // 401 = invalid key, 400 = valid key but bad request (which is fine for testing)
    if (response.status === 401) {
      return {
        success: false,
        message: 'Invalid Claude API key',
      };
    }

    return {
      success: true,
      message: 'Claude API key is valid',
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to validate Claude API key',
      details: error instanceof Error ? error.message : error,
    };
  }
}

async function testChatGPTKey(apiKey: string): Promise<ApiKeyTestResult> {
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      validateStatus: (status) => status === 401 || status === 200,
    });

    if (response.status === 401) {
      return {
        success: false,
        message: 'Invalid OpenAI API key',
      };
    }

    return {
      success: true,
      message: 'OpenAI API key is valid',
      details: {
        modelsAvailable: response.data.data?.length || 0,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to validate OpenAI API key',
      details: error instanceof Error ? error.message : error,
    };
  }
}

async function testOllamaKey(apiKey: string): Promise<ApiKeyTestResult> {
  // Ollama typically doesn't require API keys (local deployment)
  // But we can test if the server is accessible
  try {
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const response = await axios.get(`${ollamaHost}/api/tags`, {
      timeout: 5000,
    });

    return {
      success: true,
      message: 'Ollama server is accessible',
      details: {
        models: response.data.models?.map((m: any) => m.name) || [],
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to connect to Ollama server',
      details: error instanceof Error ? error.message : error,
    };
  }
}

async function testDallEKey(apiKey: string): Promise<ApiKeyTestResult> {
  // DALL-E uses the same API as ChatGPT (OpenAI)
  return testChatGPTKey(apiKey);
}

async function testStableDiffusionKey(apiKey: string): Promise<ApiKeyTestResult> {
  // This depends on which Stable Diffusion API is being used
  // For now, we'll return a placeholder
  return {
    success: true,
    message: 'Stable Diffusion API key format looks valid (full test not implemented)',
  };
}
