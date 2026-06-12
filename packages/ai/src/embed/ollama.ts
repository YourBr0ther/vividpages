import { OllamaError, postOllamaJson } from '../ollama/request';
import type { Embedder } from './types';

export interface OllamaEmbedderOptions {
  baseUrl: string;
  /** Default 'nomic-embed-text' (768 dimensions). */
  model?: string;
  /** Per-request timeout in milliseconds. Default 60_000. */
  timeoutMs?: number;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

/**
 * Embedder backed by Ollama's /api/embed endpoint, which accepts an array
 * of inputs natively, so each call is a single batched request.
 */
export class OllamaEmbedder implements Embedder {
  readonly provider = 'ollama';
  readonly model: string;
  readonly dimensions = 768;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaEmbedderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.model = opts.model ?? 'nomic-embed-text';
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const data = await postOllamaJson<OllamaEmbedResponse>({
      baseUrl: this.baseUrl,
      path: '/api/embed',
      timeoutMs: this.timeoutMs,
      body: { model: this.model, input: texts },
    });

    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new OllamaError(
        `Ollama /api/embed returned ${Array.isArray(embeddings) ? embeddings.length : 'no'} ` +
          `embeddings for ${texts.length} inputs (model '${this.model}')`,
      );
    }
    return embeddings;
  }
}
