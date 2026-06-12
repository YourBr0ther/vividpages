export interface LLMCompletion {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface CompleteOptions {
  system?: string;
  prompt: string;
  /** Request generic JSON-mode output. */
  json?: boolean;
  /**
   * JSON Schema for the expected output. Providers that support constrained
   * decoding (Ollama `format`) enforce it server-side; takes precedence over
   * the generic `json` flag. Small local models echo schemas embedded in
   * prose prompts, so constrained decoding is strongly preferred.
   */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface LLM {
  /** 'ollama' | 'anthropic' | 'openai' */
  readonly provider: string;
  readonly model: string;
  complete(opts: CompleteOptions): Promise<LLMCompletion>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
