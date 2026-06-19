import {
  createEmbedder,
  createImageGen,
  createLLM,
  type Embedder,
  type ImageGen,
  type LLM,
  type Provider,
} from '@vividpages/ai';
import { apiKeys, userSettings, type ApiKeyProvider, type Db } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';

import { decryptSecret } from '../crypto';
import { getEnv } from '../env';

/** Fallbacks when neither the book nor the owner's settings pin a model. */
const DEFAULT_LLM_PROVIDER = 'ollama';
const DEFAULT_LLM_MODEL = 'llama3.1:8b';
const DEFAULT_EMBEDDING_PROVIDER = 'ollama';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_IMAGE_PROVIDER = 'comfyui';

/** Providers that need a per-user API key (cloud). */
const CLOUD_PROVIDERS = new Set<Provider>(['anthropic', 'openai']);

/** Human label for the 'add a key' error. */
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

interface ResolvedConfig {
  provider: Provider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Resolves the concrete ProviderConfig for a chosen provider/model: for cloud
 * providers it decrypts the owner's stored api_keys row; for local providers
 * (ollama/comfyui) it uses the per-user host override or the env default.
 *
 * This is the single place provider resolution lives — the create* helpers
 * below just pick the model/host source and call it.
 */
async function resolveConfig(
  db: Db,
  userId: string,
  provider: string,
  model: string | undefined,
  localBaseUrl: () => string | undefined,
): Promise<ResolvedConfig> {
  if (CLOUD_PROVIDERS.has(provider as Provider)) {
    const row = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.provider, provider as ApiKeyProvider),
      ),
    });
    if (!row) {
      const label = PROVIDER_LABEL[provider] ?? provider;
      throw new Error(`No ${label} API key configured — add one in Settings.`);
    }
    return { provider: provider as Provider, model, apiKey: decryptSecret(row.ciphertext) };
  }
  // Local providers (ollama / comfyui): host override falls back to env.
  return { provider: provider as Provider, model, baseUrl: localBaseUrl() };
}

/**
 * Resolves the LLM for a book: book columns -> owner's user_settings -> env
 * defaults. Cloud providers (anthropic/openai) decrypt the owner's stored key
 * and construct via the ai registry; ollama uses the host override or env.
 */
export async function resolveLlm(
  db: Db,
  book: { userId: string; llmProvider: string | null; llmModel: string | null },
): Promise<LLM> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, book.userId),
  });
  const provider = book.llmProvider ?? settings?.llmProvider ?? DEFAULT_LLM_PROVIDER;
  const model = book.llmModel ?? settings?.llmModel ?? DEFAULT_LLM_MODEL;
  const config = await resolveConfig(
    db,
    book.userId,
    provider,
    model,
    () => settings?.ollamaUrl || getEnv().OLLAMA_URL,
  );
  return createLLM(config);
}

/**
 * Resolves the LLM for the wardrobe extraction stage. Unlike resolveLlm, this
 * always uses ollama with the WARDROBE_LLM_MODEL (default qwen2.5:14b — the
 * spike's choice): this offline batch stage needs 14b's single-base discipline
 * and in-list state picks regardless of the book's general LLM pin. The
 * owner's ollama host override is still honored. Pass `model` to override the
 * env default (used by tests).
 */
export async function resolveWardrobeLlm(
  db: Db,
  book: { userId: string },
  model?: string,
): Promise<LLM> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, book.userId),
  });
  const config = await resolveConfig(
    db,
    book.userId,
    'ollama',
    model ?? getEnv().WARDROBE_LLM_MODEL,
    () => settings?.ollamaUrl || getEnv().OLLAMA_URL,
  );
  return createLLM(config);
}

/**
 * Resolves the text embedder for a book's owner: user_settings -> env
 * defaults. OpenAI decrypts the owner's stored key; ollama uses host/env.
 */
export async function resolveEmbedder(db: Db, userId: string): Promise<Embedder> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const provider = settings?.embeddingProvider ?? DEFAULT_EMBEDDING_PROVIDER;
  const model = settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const config = await resolveConfig(
    db,
    userId,
    provider,
    model,
    () => settings?.ollamaUrl || getEnv().OLLAMA_URL,
  );
  return createEmbedder(config);
}

/**
 * Resolves the image generator for a book: book column -> owner's
 * user_settings -> env default. OpenAI (DALL-E) decrypts the owner's stored
 * key; comfyui uses the host override or env.
 */
export async function resolveImageGen(
  db: Db,
  book: { userId: string; imageProvider: string | null },
): Promise<ImageGen> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, book.userId),
  });
  const provider = book.imageProvider ?? settings?.imageProvider ?? DEFAULT_IMAGE_PROVIDER;
  const model = settings?.imageModel ?? undefined;
  const config = await resolveConfig(
    db,
    book.userId,
    provider,
    model,
    () => settings?.comfyuiUrl || getEnv().COMFYUI_URL,
  );
  return createImageGen(config);
}
