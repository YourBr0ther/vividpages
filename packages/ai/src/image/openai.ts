import OpenAI from 'openai';
import { OpenAIError, toOpenAIError } from '../openai/error';
import type { GenerateOptions, ImageGen, ImageResult } from './types';

export { OpenAIError };

/**
 * gpt-image-1 is OpenAI's current image model (the successor to DALL·E 3) and
 * the one the design doc names. Chosen over dall-e-3 because it's current and
 * returns base64 PNG directly. Note its hard limitations vs ComfyUI:
 *   - No negative-prompt support  → GenerateOptions.negative is ignored.
 *   - No seed control             → outputs are not reproducible; we echo -1.
 *   - Fixed size set              → we map width/height to the nearest of
 *     1024x1024, 1024x1536 (portrait), 1536x1024 (landscape).
 */
const MODEL = 'gpt-image-1';

type SupportedSize = '1024x1024' | '1024x1536' | '1536x1024';

/**
 * Maps an arbitrary requested width/height to gpt-image-1's nearest supported
 * size by aspect ratio: square -> 1024x1024, portrait -> 1024x1536,
 * landscape -> 1536x1024. The 2:3 / 3:2 boundary is treated with a small
 * dead-band around square (ratios within ~12.5% of 1:1 round to square).
 */
export function mapToSupportedSize(width: number, height: number): SupportedSize {
  const ratio = width / height;
  if (ratio > 1.125) return '1536x1024';
  if (ratio < 0.889) return '1024x1536';
  return '1024x1024';
}

function sizeDims(size: SupportedSize): { width: number; height: number } {
  const [w, h] = size.split('x').map(Number);
  return { width: w!, height: h! };
}

export interface OpenAIImageClientLike {
  images: {
    generate(body: unknown): Promise<{ data?: Array<{ b64_json?: string }> }>;
  };
  models: { list(): Promise<unknown> };
}

export interface OpenAIImageGenOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected SDK client (tests). Defaults to a real OpenAI client. */
  client?: OpenAIImageClientLike;
}

export class OpenAIImageGen implements ImageGen {
  readonly provider = 'openai';
  readonly model = MODEL;
  private readonly client: OpenAIImageClientLike;

  constructor(opts: OpenAIImageGenOptions) {
    if (!opts.apiKey && !opts.client) {
      throw new OpenAIError('OpenAIImageGen requires an apiKey');
    }
    this.client =
      opts.client ??
      (new OpenAI({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl,
      }) as unknown as OpenAIImageClientLike);
  }

  async generate(opts: GenerateOptions): Promise<ImageResult> {
    const startedAt = Date.now();
    const size = mapToSupportedSize(opts.width ?? 1024, opts.height ?? 1024);
    const { width, height } = sizeDims(size);

    // negative prompt and seed are intentionally NOT forwarded — gpt-image-1
    // supports neither.
    let resp: Awaited<ReturnType<OpenAIImageClientLike['images']['generate']>>;
    try {
      resp = await this.client.images.generate({
        model: MODEL,
        prompt: opts.prompt,
        size,
        n: 1,
      });
    } catch (err) {
      throw toOpenAIError(err, 'images.generate');
    }

    const b64 = resp.data?.[0]?.b64_json;
    if (!b64) {
      throw new OpenAIError('OpenAI images.generate returned no image data');
    }

    return {
      png: Buffer.from(b64, 'base64'),
      // gpt-image-1 has no seed control; -1 signals "not reproducible".
      seed: -1,
      width,
      height,
      durationMs: Date.now() - startedAt,
      params: {
        provider: this.provider,
        model: MODEL,
        size,
        requestedWidth: opts.width ?? 1024,
        requestedHeight: opts.height ?? 1024,
        negativeIgnored: true,
        seedControlled: false,
      },
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.models.list();
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
