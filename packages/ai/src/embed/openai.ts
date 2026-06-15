import OpenAI from 'openai';
import { OpenAIError, toOpenAIError } from '../openai/error';
import type { Embedder } from './types';

export { OpenAIError };

const DEFAULT_MODEL = 'text-embedding-3-small';
/** text-embedding-3-small default output dimensionality. */
const DEFAULT_DIMENSIONS = 1536;
/** OpenAI accepts large input arrays; this caps a single request's batch. */
const DEFAULT_BATCH_SIZE = 256;

export interface OpenAIEmbedClientLike {
  embeddings: {
    create(body: { model: string; input: string[] }): Promise<{
      data: Array<{ index: number; embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    }>;
  };
}

export interface OpenAIEmbedderOptions {
  apiKey: string;
  /** Default 'text-embedding-3-small'. */
  model?: string;
  baseUrl?: string;
  /** Max texts per API request. Default 256. */
  batchSize?: number;
  /** Injected SDK client (tests). Defaults to a real OpenAI client. */
  client?: OpenAIEmbedClientLike;
}

export class OpenAIEmbedder implements Embedder {
  readonly provider = 'openai';
  readonly model: string;
  readonly dimensions = DEFAULT_DIMENSIONS;
  private readonly batchSize: number;
  private readonly client: OpenAIEmbedClientLike;

  constructor(opts: OpenAIEmbedderOptions) {
    if (!opts.apiKey && !opts.client) {
      throw new OpenAIError('OpenAIEmbedder requires an apiKey');
    }
    this.model = opts.model ?? DEFAULT_MODEL;
    this.batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
    this.client =
      opts.client ??
      (new OpenAI({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl,
      }) as unknown as OpenAIEmbedClientLike);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      let resp: Awaited<ReturnType<OpenAIEmbedClientLike['embeddings']['create']>>;
      try {
        resp = await this.client.embeddings.create({ model: this.model, input: batch });
      } catch (err) {
        throw toOpenAIError(err, 'embeddings.create');
      }

      if (resp.data.length !== batch.length) {
        throw new OpenAIError(
          `OpenAI embeddings returned ${resp.data.length} vectors for ${batch.length} inputs (model '${this.model}')`,
        );
      }
      // The API returns each vector tagged with its input `index`; sort to be
      // robust to any reordering before appending.
      const ordered = [...resp.data].sort((a, b) => a.index - b.index);
      for (const item of ordered) out.push(item.embedding);
    }
    return out;
  }
}
