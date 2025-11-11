import OpenAI from 'openai';
import { BaseEmbeddingService } from './BaseEmbeddingService.js';

// ============================================
// OpenAI Embedding Service
// ============================================

/**
 * OpenAI embedding service using text-embedding-ada-002 or text-embedding-3-small
 */
export class OpenAIEmbeddingService extends BaseEmbeddingService {
  private client: OpenAI;
  private dimensions: number;

  constructor(apiKey: string, model?: string) {
    super(model);

    this.client = new OpenAI({
      apiKey: apiKey,
    });

    // Set dimensions based on model
    this.dimensions = this.getModelDimensions(this.model);
  }

  /**
   * Get the default model for OpenAI embeddings
   */
  protected getDefaultModel(): string {
    return 'text-embedding-3-small'; // More cost-effective than ada-002
  }

  /**
   * Get dimensions for a specific model
   */
  private getModelDimensions(model: string): number {
    switch (model) {
      case 'text-embedding-ada-002':
        return 1536;
      case 'text-embedding-3-small':
        return 1536; // Can be configured, but default is 1536
      case 'text-embedding-3-large':
        return 3072; // Can be configured, but default is 3072
      default:
        return 1536; // Default to 1536
    }
  }

  /**
   * Get the dimension size of the embeddings
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const normalized = this.normalizeText(text);

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: normalized,
        encoding_format: 'float',
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('OpenAI embedding error:', error);
      throw new Error(`Failed to generate OpenAI embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // OpenAI supports batch embedding
    const normalized = texts.map(t => this.normalizeText(t));

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: normalized,
        encoding_format: 'float',
      });

      // Sort by index to ensure order matches input
      return response.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);
    } catch (error) {
      console.error('OpenAI batch embedding error:', error);
      throw new Error(`Failed to generate OpenAI batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if the OpenAI service is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Try to list models as a health check
      await this.client.models.list();
      return true;
    } catch (error) {
      console.error('OpenAI health check failed:', error);
      return false;
    }
  }
}
