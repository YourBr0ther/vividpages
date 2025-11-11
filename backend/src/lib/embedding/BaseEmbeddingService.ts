// ============================================
// Base Embedding Service (Abstract Class)
// ============================================

/**
 * Abstract base class for embedding services
 * Provides a unified interface for generating embeddings from different providers
 */
export abstract class BaseEmbeddingService {
  protected model: string;

  constructor(model?: string) {
    this.model = model || this.getDefaultModel();
  }

  /**
   * Generate embedding for a single text
   * @param text The text to embed
   * @returns Array of numbers representing the embedding vector
   */
  abstract embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in batch
   * @param texts Array of texts to embed
   * @returns Array of embedding vectors
   */
  abstract embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension size of the embeddings
   * @returns Number of dimensions (e.g., 1536 for text-embedding-ada-002)
   */
  abstract getDimensions(): number;

  /**
   * Get the current model being used
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the default model for this provider
   */
  protected abstract getDefaultModel(): string;

  /**
   * Check if the service is healthy and available
   */
  abstract checkHealth(): Promise<boolean>;

  /**
   * Calculate cosine similarity between two vectors
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimensions don't match: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Normalize text for embedding (remove extra whitespace, trim, etc.)
   * @param text The text to normalize
   * @returns Normalized text
   */
  protected normalizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/\n+/g, ' '); // Replace newlines with spaces
  }
}
