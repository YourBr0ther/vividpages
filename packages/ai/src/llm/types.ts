export interface LLMCompletion {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface CompleteOptions {
  system?: string;
  prompt: string;
  json?: boolean;
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
