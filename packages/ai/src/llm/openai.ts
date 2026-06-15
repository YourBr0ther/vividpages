import OpenAI from 'openai';
import { OpenAIError, toOpenAIError } from '../openai/error';
import type { CompleteOptions, LLM, LLMCompletion } from './types';

export { OpenAIError };

/**
 * Default chat model. Chosen per the claude-api skill's guidance to "pick a
 * current model": gpt-4.1 is OpenAI's current flagship with first-class
 * structured-outputs support (response_format json_schema, strict mode), which
 * is what completeStructured relies on for clean JSON. gpt-4o is the lower-cost
 * alternative; callers can override via `model`.
 */
const DEFAULT_MODEL = 'gpt-4.1';

const JSON_SCHEMA_NAME = 'structured_output';

/** The slice of the OpenAI SDK this adapter depends on (for injection in tests). */
export interface OpenAIChatClientLike {
  chat: {
    completions: {
      create(body: unknown): Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>;
    };
  };
  models: { list(): Promise<unknown> };
}

export interface OpenAILLMOptions {
  apiKey: string;
  /** Default 'gpt-4.1'. */
  model?: string;
  /** Optional custom base URL (e.g. an Azure/compatible gateway). */
  baseUrl?: string;
  /** Injected SDK client (tests). Defaults to a real OpenAI client. */
  client?: OpenAIChatClientLike;
}

export class OpenAILLM implements LLM {
  readonly provider = 'openai';
  readonly model: string;
  private readonly client: OpenAIChatClientLike;

  constructor(opts: OpenAILLMOptions) {
    if (!opts.apiKey && !opts.client) {
      throw new OpenAIError('OpenAILLM requires an apiKey');
    }
    this.model = opts.model ?? DEFAULT_MODEL;
    this.client =
      opts.client ??
      (new OpenAI({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl,
      }) as unknown as OpenAIChatClientLike);
  }

  async complete(opts: CompleteOptions): Promise<LLMCompletion> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    // Structured outputs: a JSON Schema gives the strongest guarantee; plain
    // json mode falls back to a free-form JSON object.
    if (opts.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: JSON_SCHEMA_NAME,
          strict: true,
          schema: opts.jsonSchema,
        },
      };
    } else if (opts.json) {
      body.response_format = { type: 'json_object' };
    }

    let resp: Awaited<ReturnType<OpenAIChatClientLike['chat']['completions']['create']>>;
    try {
      resp = await this.client.chat.completions.create(body);
    } catch (err) {
      throw toOpenAIError(err, 'chat.completions.create');
    }

    return {
      text: resp.choices[0]?.message?.content ?? '',
      tokensIn: resp.usage?.prompt_tokens ?? 0,
      tokensOut: resp.usage?.completion_tokens ?? 0,
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
