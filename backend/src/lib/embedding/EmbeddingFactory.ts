import { BaseEmbeddingService } from './BaseEmbeddingService.js';
import { OpenAIEmbeddingService } from './OpenAIEmbeddingService.js';
import { OllamaEmbeddingService } from './OllamaEmbeddingService.js';
import { getApiKeyByProvider } from '../apiKeyService.js';

// ============================================
// Embedding Provider Types
// ============================================

export enum EmbeddingProvider {
  OPENAI = 'openai',
  OLLAMA = 'ollama',
}

export interface EmbeddingServiceOptions {
  model?: string;
  host?: string; // For Ollama
}

// ============================================
// Embedding Factory
// ============================================

/**
 * Factory for creating embedding service instances
 */
export class EmbeddingFactory {
  /**
   * Create an embedding service for a specific provider
   * @param userId User ID for API key retrieval
   * @param provider Embedding provider (openai, ollama)
   * @param options Additional options (model, host, etc.)
   */
  static async create(
    userId: string,
    provider: EmbeddingProvider | string,
    options: EmbeddingServiceOptions = {}
  ): Promise<BaseEmbeddingService> {
    const providerLower = provider.toLowerCase();

    switch (providerLower) {
      case EmbeddingProvider.OPENAI:
        return await this.createOpenAIService(userId, options.model);

      case EmbeddingProvider.OLLAMA:
        return this.createOllamaService(options.host, options.model);

      default:
        throw new Error(`Unsupported embedding provider: ${provider}. Supported: ${Object.values(EmbeddingProvider).join(', ')}`);
    }
  }

  /**
   * Create OpenAI embedding service
   */
  private static async createOpenAIService(userId: string, model?: string): Promise<OpenAIEmbeddingService> {
    // Try to get API key for ChatGPT (OpenAI) provider
    const apiKey = await getApiKeyByProvider(userId, 'chatgpt');

    if (!apiKey) {
      throw new Error('No OpenAI API key found. Please add an OpenAI API key in settings.');
    }

    return new OpenAIEmbeddingService(apiKey, model);
  }

  /**
   * Create Ollama embedding service (no API key required)
   */
  private static createOllamaService(host?: string, model?: string): OllamaEmbeddingService {
    return new OllamaEmbeddingService(host, model);
  }

  /**
   * Get available embedding providers for a user
   * @param userId User ID to check API keys
   * @returns Array of available provider names
   */
  static async getAvailableProviders(userId: string): Promise<EmbeddingProvider[]> {
    const available: EmbeddingProvider[] = [];

    // Check if OpenAI API key exists
    const openaiKey = await getApiKeyByProvider(userId, 'chatgpt');
    if (openaiKey) {
      available.push(EmbeddingProvider.OPENAI);
    }

    // Ollama is always available if the server is running (no API key required)
    available.push(EmbeddingProvider.OLLAMA);

    return available;
  }

  /**
   * Check if a specific provider is available for a user
   * @param userId User ID to check API keys
   * @param provider Provider to check
   * @returns True if provider is available
   */
  static async isProviderAvailable(userId: string, provider: EmbeddingProvider | string): Promise<boolean> {
    const available = await this.getAvailableProviders(userId);
    return available.includes(provider as EmbeddingProvider);
  }
}
