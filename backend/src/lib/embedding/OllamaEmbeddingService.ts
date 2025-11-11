import Ollama from 'ollama';
import { BaseEmbeddingService } from './BaseEmbeddingService.js';

// ============================================
// Ollama Embedding Service
// ============================================

/**
 * Ollama embedding service using local embedding models
 * Supports models like: nomic-embed-text, mxbai-embed-large, etc.
 */
export class OllamaEmbeddingService extends BaseEmbeddingService {
  private client: Ollama;
  private host: string;

  constructor(host?: string, model?: string) {
    super(model);

    this.host = host || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.client = new Ollama({ host: this.host });
  }

  /**
   * Get the default model for Ollama embeddings
   */
  protected getDefaultModel(): string {
    return 'nomic-embed-text'; // Popular open-source embedding model
  }

  /**
   * Get the dimension size of the embeddings
   * Note: Different models have different dimensions
   */
  getDimensions(): number {
    // Common Ollama embedding model dimensions
    switch (this.model) {
      case 'nomic-embed-text':
        return 768;
      case 'mxbai-embed-large':
        return 1024;
      case 'all-minilm':
        return 384;
      default:
        return 768; // Default assumption
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const normalized = this.normalizeText(text);

    try {
      const response = await this.client.embeddings({
        model: this.model,
        prompt: normalized,
      });

      return response.embedding;
    } catch (error) {
      console.error('Ollama embedding error:', error);
      throw new Error(`Failed to generate Ollama embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * Note: Ollama doesn't have native batch support, so we'll process sequentially
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];

    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);

      // Small delay to avoid overwhelming the server
      if (texts.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return embeddings;
  }

  /**
   * Check if the Ollama service is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Try to list models as a health check
      await this.client.list();
      return true;
    } catch (error) {
      console.error('Ollama health check failed:', error);
      return false;
    }
  }

  /**
   * Get the host URL
   */
  getHost(): string {
    return this.host;
  }
}
