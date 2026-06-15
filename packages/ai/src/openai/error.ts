/**
 * Shared OpenAI error taxonomy used by the chat LLM, embedder, and image
 * adapters. The official SDK throws richly-typed errors (APIError subclasses
 * with `.status` and `.type`); we normalize them onto one class so callers can
 * branch on `status` / `code` without depending on the SDK's class hierarchy.
 */
export class OpenAIError extends Error {
  /** HTTP status from the SDK error, when present. */
  readonly status?: number;
  /** API error `type` string (e.g. 'rate_limit_error'), when present. */
  readonly code?: string;

  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'OpenAIError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

/** Maps a thrown SDK error onto the OpenAIError taxonomy. */
export function toOpenAIError(err: unknown, context: string): OpenAIError {
  const status =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;
  const detail = err instanceof Error ? err.message : String(err);
  // The SDK's connection/timeout errors carry no body, so `type` is undefined.
  // Normalize them onto the same NETWORK/TIMEOUT vocabulary ComfyUI uses so
  // callers can treat "the provider is unreachable" as systemic across both
  // image providers. Timeout is a subclass of connection error — check it first.
  const name = err instanceof Error ? err.name : '';
  let code: string | undefined;
  if (name === 'APIConnectionTimeoutError') {
    code = 'TIMEOUT';
  } else if (name === 'APIConnectionError') {
    code = 'NETWORK';
  } else if (typeof (err as { type?: unknown })?.type === 'string') {
    code = (err as { type: string }).type;
  }
  return new OpenAIError(`OpenAI ${context} failed: ${detail}`, { status, code });
}
