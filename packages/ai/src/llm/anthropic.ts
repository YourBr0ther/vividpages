import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOptions, LLM, LLMCompletion } from './types';

/**
 * Default Claude model. Chosen per the design doc (Task 27) and confirmed
 * against the claude-api skill's model catalog: claude-sonnet-4-6 is the
 * current Sonnet — best speed/intelligence balance for high-volume scene
 * analysis. Opus 4.8 is available via the `model` option when a book warrants
 * the extra capability. (The skill's blanket "default to opus-4-8" is for
 * generic codegen; this pipeline deliberately defaults to Sonnet for cost.)
 */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Anthropic caps each request at this many output tokens by default. */
const DEFAULT_MAX_TOKENS = 4096;

/** Forced-tool name used to coax reliable JSON out of the model. */
const JSON_TOOL_NAME = 'emit_structured_output';

export class AnthropicError extends Error {
  /** HTTP status from the SDK error, when present. */
  readonly status?: number;
  /** API error `type` string (e.g. 'authentication_error'), when present. */
  readonly code?: string;

  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'AnthropicError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

/** The slice of the Anthropic SDK this adapter depends on (for injection in tests). */
export interface AnthropicClientLike {
  messages: {
    create(body: unknown): Promise<{
      content: Array<{ type: string; text?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
  models: { list(): Promise<unknown> };
}

export interface AnthropicLLMOptions {
  apiKey: string;
  /** Default 'claude-sonnet-4-6'. */
  model?: string;
  /** Default 4096. */
  maxTokens?: number;
  /** Injected SDK client (tests). Defaults to a real Anthropic client. */
  client?: AnthropicClientLike;
}

/** Maps a thrown SDK error onto the AnthropicError taxonomy. */
function toAnthropicError(err: unknown, context: string): AnthropicError {
  const status =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
  const code =
    typeof (err as { type?: unknown })?.type === 'string'
      ? (err as { type: string }).type
      : undefined;
  const detail = err instanceof Error ? err.message : String(err);
  return new AnthropicError(`Anthropic ${context} failed: ${detail}`, { status, code });
}

export class AnthropicLLM implements LLM {
  readonly provider = 'anthropic';
  readonly model: string;
  private readonly maxTokens: number;
  private readonly client: AnthropicClientLike;

  constructor(opts: AnthropicLLMOptions) {
    if (!opts.apiKey && !opts.client) {
      throw new AnthropicError('AnthropicLLM requires an apiKey');
    }
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.client =
      opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicClientLike);
  }

  async complete(opts: CompleteOptions): Promise<LLMCompletion> {
    // Structured output via forced tool use: register a single tool whose
    // input_schema is the requested JSON Schema, force the model to call it,
    // and return the call's input verbatim as JSON text. This is far more
    // reliable than free-text JSON and lets completeStructured parse cleanly.
    const useTool = !!opts.jsonSchema;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.maxTokens ?? this.maxTokens,
      messages: [{ role: 'user', content: opts.prompt }],
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    let system = opts.system;
    if (useTool) {
      body.tools = [
        {
          name: JSON_TOOL_NAME,
          description: 'Return the structured result as the tool input.',
          input_schema: opts.jsonSchema,
        },
      ];
      body.tool_choice = { type: 'tool', name: JSON_TOOL_NAME };
    } else if (opts.json) {
      // Generic JSON mode (no schema): nudge via the system prompt; Anthropic
      // has no native JSON-only flag without a tool.
      const jsonHint = 'Respond with a single JSON object and nothing else.';
      system = system ? `${system}\n\n${jsonHint}` : jsonHint;
    }
    if (system) body.system = system;

    let resp: Awaited<ReturnType<AnthropicClientLike['messages']['create']>>;
    try {
      resp = await this.client.messages.create(body);
    } catch (err) {
      throw toAnthropicError(err, 'messages.create');
    }

    const tokensIn = resp.usage?.input_tokens ?? 0;
    const tokensOut = resp.usage?.output_tokens ?? 0;

    if (useTool) {
      const toolBlock = resp.content.find(
        (b) => b.type === 'tool_use' && b.input !== undefined,
      );
      if (!toolBlock) {
        throw new AnthropicError(
          'Anthropic returned no tool_use block for a forced structured request',
        );
      }
      return { text: JSON.stringify(toolBlock.input), tokensIn, tokensOut };
    }

    const text = resp.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    return { text, tokensIn, tokensOut };
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
