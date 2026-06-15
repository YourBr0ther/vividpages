import { OpenAIError } from '../openai/error';
import { ComfyUIError } from './comfyui';

/**
 * `.code` values (shared across both image providers) that mean the provider
 * itself is unreachable — no image can succeed until it comes back. ComfyUI
 * raises these directly; OpenAI's SDK connection/timeout errors are normalized
 * onto the same vocabulary by `toOpenAIError`.
 */
export const systemicImageCodes = new Set(['NETWORK', 'TIMEOUT']);

/**
 * True for an error thrown by an image provider adapter (ComfyUI or OpenAI),
 * as opposed to an unrelated failure (sharp encode, MinIO upload, db insert).
 * Lets the imagine stage treat any provider image error with one policy:
 * per-image retry + record-and-continue + consecutive-systemic abort.
 */
export function isImageProviderError(err: unknown): err is ComfyUIError | OpenAIError {
  return err instanceof ComfyUIError || err instanceof OpenAIError;
}

/** True for a provider image error whose code means the server is gone. */
export function isSystemicImageError(err: unknown): boolean {
  return (
    isImageProviderError(err) && err.code != null && systemicImageCodes.has(err.code)
  );
}
