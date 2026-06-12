import { ComfyUIImageGen, OllamaEmbedder, OllamaLLM } from '@vividpages/ai';
import { userSettings, type Db } from '@vividpages/db';
import { eq } from 'drizzle-orm';

import { getEnv } from '../env';

/** Fallbacks when neither the book nor the owner's settings pin a model. */
const DEFAULT_LLM_PROVIDER = 'ollama';
const DEFAULT_LLM_MODEL = 'llama3.1:8b';
const DEFAULT_EMBEDDING_PROVIDER = 'ollama';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_IMAGE_PROVIDER = 'comfyui';

/**
 * Resolves the LLM for a book: book columns -> owner's user_settings -> env
 * defaults. Only Ollama is wired up here; cloud providers arrive in M6 (T27).
 */
export async function resolveLlm(
  db: Db,
  book: { userId: string; llmProvider: string | null; llmModel: string | null },
): Promise<OllamaLLM> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, book.userId),
  });
  const provider = book.llmProvider ?? settings?.llmProvider ?? DEFAULT_LLM_PROVIDER;
  const model = book.llmModel ?? settings?.llmModel ?? DEFAULT_LLM_MODEL;
  if (provider !== 'ollama') {
    throw new Error(
      `pipeline: LLM provider '${provider}' is not yet supported — ` +
        `only 'ollama' is wired up (anthropic/openai land in M6).`,
    );
  }
  const baseUrl = settings?.ollamaUrl || getEnv().OLLAMA_URL;
  return new OllamaLLM({ baseUrl, model });
}

/**
 * Resolves the text embedder for a book's owner: user_settings -> env
 * defaults. Only Ollama is wired up here (same M6 note as resolveLlm).
 */
export async function resolveEmbedder(db: Db, userId: string): Promise<OllamaEmbedder> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const provider = settings?.embeddingProvider ?? DEFAULT_EMBEDDING_PROVIDER;
  const model = settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  if (provider !== 'ollama') {
    throw new Error(
      `pipeline: embedding provider '${provider}' is not yet supported — only 'ollama' is wired up.`,
    );
  }
  const baseUrl = settings?.ollamaUrl || getEnv().OLLAMA_URL;
  return new OllamaEmbedder({ baseUrl, model });
}

/**
 * Resolves the image generator for a book: book column -> owner's
 * user_settings -> env default. Only ComfyUI is wired up here; cloud image
 * providers (DALL-E) arrive in M6 (T27).
 */
export async function resolveImageGen(
  db: Db,
  book: { userId: string; imageProvider: string | null },
): Promise<ComfyUIImageGen> {
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, book.userId),
  });
  const provider = book.imageProvider ?? settings?.imageProvider ?? DEFAULT_IMAGE_PROVIDER;
  if (provider !== 'comfyui') {
    throw new Error(
      `pipeline: image provider '${provider}' is not yet supported — ` +
        `only 'comfyui' is wired up (cloud image providers land in M6).`,
    );
  }
  const baseUrl = settings?.comfyuiUrl || getEnv().COMFYUI_URL;
  return new ComfyUIImageGen({ baseUrl });
}
