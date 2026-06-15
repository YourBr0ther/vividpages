/**
 * Provider registry: pure, synchronous construction of LLM / Embedder /
 * ImageGen adapters from a flat config. This is the single seam that Task 28
 * (encrypted API keys) feeds into and that the pipeline's resolveLlm /
 * resolveEmbedder / resolveImageGen helpers will call.
 *
 * INTEGRATION POINT (future task): the pipeline currently constructs Ollama /
 * ComfyUI adapters directly. A small follow-up task will route those through
 * these factories — passing decrypted per-user keys for the cloud providers
 * and the per-user host overrides for ollama/comfyui — so provider selection
 * lives in one place. Do NOT wire that here; this module stays pure.
 */
import { OllamaEmbedder } from './embed/ollama';
import { OpenAIEmbedder } from './embed/openai';
import type { Embedder } from './embed/types';
import { ComfyUIImageGen } from './image/comfyui';
import { OpenAIImageGen } from './image/openai';
import type { ImageGen } from './image/types';
import { AnthropicLLM } from './llm/anthropic';
import { OllamaLLM } from './llm/ollama';
import { OpenAILLM } from './llm/openai';
import type { LLM } from './llm/types';

export type Provider = 'ollama' | 'anthropic' | 'openai' | 'comfyui';

export interface ProviderConfig {
  provider: Provider;
  /** Required for anthropic / openai. */
  apiKey?: string;
  /** Required for ollama / comfyui (the self-hosted host URL). */
  baseUrl?: string;
  /** Optional model override; falls back to each adapter's default. */
  model?: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

function requireApiKey(cfg: ProviderConfig): string {
  if (!cfg.apiKey) {
    throw new RegistryError(`provider '${cfg.provider}' requires an apiKey`);
  }
  return cfg.apiKey;
}

function requireBaseUrl(cfg: ProviderConfig): string {
  if (!cfg.baseUrl) {
    throw new RegistryError(`provider '${cfg.provider}' requires a baseUrl`);
  }
  return cfg.baseUrl;
}

export function createLLM(cfg: ProviderConfig): LLM {
  switch (cfg.provider) {
    case 'ollama':
      return new OllamaLLM({
        baseUrl: requireBaseUrl(cfg),
        model: cfg.model ?? 'llama3.1:8b',
      });
    case 'anthropic':
      return new AnthropicLLM({ apiKey: requireApiKey(cfg), model: cfg.model });
    case 'openai':
      return new OpenAILLM({
        apiKey: requireApiKey(cfg),
        model: cfg.model,
        baseUrl: cfg.baseUrl,
      });
    default:
      throw new RegistryError(`unknown or unsupported LLM provider: '${cfg.provider}'`);
  }
}

export function createEmbedder(cfg: ProviderConfig): Embedder {
  switch (cfg.provider) {
    case 'ollama':
      return new OllamaEmbedder({ baseUrl: requireBaseUrl(cfg), model: cfg.model });
    case 'openai':
      return new OpenAIEmbedder({
        apiKey: requireApiKey(cfg),
        model: cfg.model,
        baseUrl: cfg.baseUrl,
      });
    default:
      throw new RegistryError(`unknown or unsupported embedder provider: '${cfg.provider}'`);
  }
}

export function createImageGen(cfg: ProviderConfig): ImageGen {
  switch (cfg.provider) {
    case 'comfyui':
      return new ComfyUIImageGen({ baseUrl: requireBaseUrl(cfg), checkpoint: cfg.model });
    case 'openai':
      return new OpenAIImageGen({ apiKey: requireApiKey(cfg), baseUrl: cfg.baseUrl });
    default:
      throw new RegistryError(`unknown or unsupported image provider: '${cfg.provider}'`);
  }
}
