/**
 * Shared Ollama HTTP plumbing: one error taxonomy and one JSON-POST helper
 * used by both the chat LLM adapter and the embedder.
 */

export class OllamaError extends Error {
  readonly status?: number;
  /**
   * 'MODEL_NOT_FOUND' — the model is not available on the server.
   * 'TIMEOUT'         — the request exceeded timeoutMs.
   * 'NETWORK'         — the server could not be reached (fetch failed).
   */
  readonly code?: string;

  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'OllamaError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

export interface OllamaPostArgs {
  /** Server base URL, with or without a trailing slash. */
  baseUrl: string;
  /** Endpoint path, e.g. '/api/chat'. */
  path: string;
  body: unknown;
  timeoutMs: number;
}

/**
 * POSTs JSON to an Ollama endpoint and returns the parsed JSON response.
 * Timeouts, connection failures, and non-2xx responses (including missing
 * models) are mapped onto the OllamaError taxonomy.
 */
export async function postOllamaJson<T>(args: OllamaPostArgs): Promise<T> {
  const baseUrl = args.baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${args.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new OllamaError(
        `Ollama ${args.path} timed out after ${args.timeoutMs}ms (at ${baseUrl})`,
        { code: 'TIMEOUT' },
      );
    }
    // Undici reports connection problems as TypeError('fetch failed') with
    // the underlying error on `cause`.
    const cause =
      err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : '';
    const detail = err instanceof Error ? err.message : String(err);
    throw new OllamaError(`Ollama request to ${baseUrl} failed (${detail}${cause})`, {
      code: 'NETWORK',
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const excerpt = body.slice(0, 500);
    // Prefer the error body for detection: a bare 404 with an unrelated (or
    // empty) body may just be a misrouted baseUrl, not a missing model.
    const modelNotFound =
      /model\b.*(not found|not exist)/i.test(excerpt) ||
      (res.status === 404 && excerpt.trim() === '');
    throw new OllamaError(`Ollama ${args.path} failed (${res.status}): ${excerpt}`, {
      status: res.status,
      code: modelNotFound ? 'MODEL_NOT_FOUND' : undefined,
    });
  }

  return (await res.json()) as T;
}
