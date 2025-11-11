import { BaseLLMService, LLMProvider, LLMConfig } from './BaseLLMService.js';
import { OllamaService } from './OllamaService.js';
import { ClaudeService } from './ClaudeService.js';
import { ChatGPTService } from './ChatGPTService.js';
import { getApiKeyByProvider } from '../apiKeyService.js';

// ============================================
// LLM Factory
// ============================================

/**
 * Factory for creating LLM service instances
 * Handles provider selection and API key retrieval
 */
export class LLMFactory {
  /**
   * Create an LLM service instance for a specific user and provider
   *
   * @param userId - The user's ID to fetch their API keys
   * @param provider - The LLM provider to use (ollama, claude, chatgpt)
   * @param config - Optional configuration overrides
   * @returns Configured LLM service instance
   */
  static async create(
    userId: string,
    provider: LLMProvider | string,
    config?: Partial<LLMConfig>
  ): Promise<BaseLLMService> {
    const providerEnum = this.normalizeProvider(provider);

    switch (providerEnum) {
      case LLMProvider.OLLAMA:
        return this.createOllamaService(config);

      case LLMProvider.CLAUDE:
        return await this.createClaudeService(userId, config);

      case LLMProvider.CHATGPT:
        return await this.createChatGPTService(userId, config);

      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  /**
   * Create Ollama service (no API key required)
   */
  private static createOllamaService(config?: Partial<LLMConfig>): OllamaService {
    const ollamaHost = process.env.OLLAMA_HOST;

    return new OllamaService({
      ...config,
      host: ollamaHost,
    });
  }

  /**
   * Create Claude service (requires API key)
   */
  private static async createClaudeService(
    userId: string,
    config?: Partial<LLMConfig>
  ): Promise<ClaudeService> {
    const apiKey = await getApiKeyByProvider(userId, 'claude');

    if (!apiKey) {
      throw new Error('Claude API key not found. Please add your API key in Settings.');
    }

    return new ClaudeService(apiKey, config);
  }

  /**
   * Create ChatGPT service (requires API key)
   */
  private static async createChatGPTService(
    userId: string,
    config?: Partial<LLMConfig>
  ): Promise<ChatGPTService> {
    const apiKey = await getApiKeyByProvider(userId, 'chatgpt');

    if (!apiKey) {
      throw new Error('OpenAI API key not found. Please add your API key in Settings.');
    }

    return new ChatGPTService(apiKey, config);
  }

  /**
   * Normalize provider string to enum
   */
  private static normalizeProvider(provider: LLMProvider | string): LLMProvider {
    const providerLower = provider.toLowerCase();

    switch (providerLower) {
      case 'ollama':
      case LLMProvider.OLLAMA:
        return LLMProvider.OLLAMA;

      case 'claude':
      case 'anthropic':
      case LLMProvider.CLAUDE:
        return LLMProvider.CLAUDE;

      case 'chatgpt':
      case 'openai':
      case 'gpt':
      case LLMProvider.CHATGPT:
        return LLMProvider.CHATGPT;

      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  /**
   * Get available providers for a user
   * Returns list of providers the user has API keys for (+ ollama which is always available)
   */
  static async getAvailableProviders(userId: string): Promise<LLMProvider[]> {
    const providers: LLMProvider[] = [LLMProvider.OLLAMA]; // Ollama is always available

    try {
      // Check for Claude API key
      const claudeKey = await getApiKeyByProvider(userId, 'claude');
      if (claudeKey) {
        providers.push(LLMProvider.CLAUDE);
      }
    } catch (error) {
      // Ignore errors, just don't add provider
    }

    try {
      // Check for ChatGPT API key
      const chatgptKey = await getApiKeyByProvider(userId, 'chatgpt');
      if (chatgptKey) {
        providers.push(LLMProvider.CHATGPT);
      }
    } catch (error) {
      // Ignore errors, just don't add provider
    }

    return providers;
  }

  /**
   * Check if a specific provider is available for a user
   */
  static async isProviderAvailable(userId: string, provider: LLMProvider | string): Promise<boolean> {
    const providerEnum = this.normalizeProvider(provider);

    if (providerEnum === LLMProvider.OLLAMA) {
      return true; // Ollama is always available
    }

    const providerName = providerEnum === LLMProvider.CLAUDE ? 'claude' : 'chatgpt';

    try {
      const apiKey = await getApiKeyByProvider(userId, providerName);
      return !!apiKey;
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance for convenience
export const llmFactory = LLMFactory;

// Re-export LLMProvider enum for convenience
export { LLMProvider };
