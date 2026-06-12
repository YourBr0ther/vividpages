import { OllamaError, postOllamaJson } from '../ollama/request';
import type { CompleteOptions, LLM, LLMCompletion } from './types';

// Re-exported here for backwards compatibility: OllamaError predates the
// shared request module and is widely imported from this path.
export { OllamaError };

export interface OllamaLLMOptions {
  baseUrl: string;
  model: string;
  /** Per-request timeout in milliseconds. Default 120_000. */
  timeoutMs?: number;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaLLM implements LLM {
  readonly provider = 'ollama';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaLLMOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async complete(opts: CompleteOptions): Promise<LLMCompletion> {
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const data = await postOllamaJson<OllamaChatResponse>({
      baseUrl: this.baseUrl,
      path: '/api/chat',
      timeoutMs: this.timeoutMs,
      body: {
        model: this.model,
        messages,
        stream: false,
        format: opts.jsonSchema ?? (opts.json ? 'json' : undefined),
        options: {
          num_predict: opts.maxTokens,
          temperature: opts.temperature,
        },
      },
    });

    return {
      text: data.message?.content ?? '',
      tokensIn: data.prompt_eval_count ?? 0,
      tokensOut: data.eval_count ?? 0,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        return { ok: false, detail: `GET /api/tags returned ${res.status}` };
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (data.models ?? []).map((m) => m.name ?? '');
      // Ollama lists models as 'name:tag'; accept exact match or bare-name match.
      const present = names.some(
        (n) => n === this.model || n.split(':')[0] === this.model,
      );
      if (!present) {
        return {
          ok: false,
          detail: `model '${this.model}' not present on server (available: ${names.join(', ') || 'none'})`,
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
