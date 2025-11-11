import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  createApiKey,
  getUserApiKeys,
  updateApiKey,
  deleteApiKey,
  testApiKey,
  type ApiKeyInput,
} from '../../lib/apiKeyService.js';

const router = express.Router();

/**
 * Get all API keys for the authenticated user
 * GET /api/api-keys
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const apiKeys = await getUserApiKeys(userId);

    res.json({
      success: true,
      apiKeys,
    });
  } catch (error) {
    console.error('❌ Error fetching API keys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch API keys',
    });
  }
});

/**
 * Create a new API key
 * POST /api/api-keys
 */
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { provider, apiKey, nickname } = req.body;

    // Validation
    if (!provider || !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Provider and API key are required',
      });
    }

    const validProviders = ['claude', 'chatgpt', 'ollama', 'dall-e', 'stable-diffusion', 'other'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
      });
    }

    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'API key must be a non-empty string',
      });
    }

    const input: ApiKeyInput = {
      provider,
      apiKey: apiKey.trim(),
      nickname: nickname?.trim() || null,
    };

    const newApiKey = await createApiKey(userId, input);

    res.status(201).json({
      success: true,
      message: 'API key created successfully',
      apiKey: newApiKey,
    });
  } catch (error) {
    console.error('❌ Error creating API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create API key',
    });
  }
});

/**
 * Update an existing API key
 * PUT /api/api-keys/:id
 */
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const keyId = req.params.id;
    const { provider, apiKey, nickname } = req.body;

    // Build updates object
    const updates: Partial<ApiKeyInput> = {};

    if (provider !== undefined) {
      updates.provider = provider;
    }

    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'API key must be a non-empty string',
        });
      }
      updates.apiKey = apiKey.trim();
    }

    if (nickname !== undefined) {
      updates.nickname = nickname?.trim() || null;
    }

    const updatedApiKey = await updateApiKey(userId, keyId, updates);

    res.json({
      success: true,
      message: 'API key updated successfully',
      apiKey: updatedApiKey,
    });
  } catch (error) {
    console.error('❌ Error updating API key:', error);

    if (error instanceof Error && error.message === 'API key not found') {
      return res.status(404).json({
        success: false,
        error: 'API key not found',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update API key',
    });
  }
});

/**
 * Delete an API key (soft delete)
 * DELETE /api/api-keys/:id
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const keyId = req.params.id;

    await deleteApiKey(userId, keyId);

    res.json({
      success: true,
      message: 'API key deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete API key',
    });
  }
});

/**
 * Test an API key before saving
 * POST /api/api-keys/test
 */
router.post('/test', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { provider, apiKey } = req.body;

    if (!provider || !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Provider and API key are required',
      });
    }

    const result = await testApiKey(provider, apiKey);

    res.json({
      success: result.success,
      message: result.message,
      details: result.details,
    });
  } catch (error) {
    console.error('❌ Error testing API key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test API key',
    });
  }
});

export default router;
