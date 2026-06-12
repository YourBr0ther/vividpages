export interface Embedder {
  /** 'ollama' | 'openai' | ... */
  readonly provider: string;
  readonly model: string;
  /** Dimensionality of every vector this embedder produces. */
  readonly dimensions: number;
  /** Embeds a batch of texts; result[i] corresponds to texts[i]. */
  embed(texts: string[]): Promise<number[][]>;
}
