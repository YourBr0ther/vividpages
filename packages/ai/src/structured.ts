import { z } from 'zod';
import type { LLM } from './llm/types';

export interface StructuredOptions<T> {
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Total completion attempts before giving up. Default 3, clamped to >= 1. */
  maxAttempts?: number;
  temperature?: number;
  maxTokens?: number;
}

/** Max chars of a previous response echoed into repair prompts / error messages. */
const RESPONSE_EXCERPT_MAX_CHARS = 2000;

/** Truncates long text, appending an explicit truncation note. */
function excerptOf(text: string, max = RESPONSE_EXCERPT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[... truncated, ${text.length - max} more chars]`;
}

export interface StructuredResult<T> {
  value: T;
  attempts: number;
  tokensIn: number;
  tokensOut: number;
}

export class StructuredOutputError extends Error {
  readonly attempts: number;
  readonly lastErrors: unknown;
  readonly lastText: string;

  constructor(args: { attempts: number; lastErrors: unknown; lastText: string }) {
    super(
      `Structured output failed after ${args.attempts} attempt(s): ${JSON.stringify(args.lastErrors)}; last response: ${excerptOf(args.lastText)}`,
    );
    this.name = 'StructuredOutputError';
    this.attempts = args.attempts;
    this.lastErrors = args.lastErrors;
    this.lastText = args.lastText;
  }
}

/** Compact textual description of the expected JSON shape, derived from the zod schema. */
function describeSchema(schema: z.ZodType<unknown>): string {
  try {
    return JSON.stringify(z.toJSONSchema(schema));
  } catch {
    // Some schemas (e.g. transforms, custom types) cannot be converted; the
    // repair loop still enforces the schema, so a generic hint is acceptable.
    return 'an object matching the requested structure';
  }
}

/**
 * Strip markdown code fences; fall back to a '{' .. last '}' span. When prose
 * before the JSON itself contains braces, successive candidate start braces
 * are tried until one yields parseable JSON.
 */
export function extractJsonText(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fence?.[1] !== undefined) text = fence[1].trim();
  if (text.startsWith('{')) return text;

  const end = text.lastIndexOf('}');
  let start = text.indexOf('{');
  while (start !== -1 && start < end) {
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      start = text.indexOf('{', start + 1);
    }
  }
  // Nothing parsed: keep the widest span (original behavior) so the caller's
  // JSON.parse error mentions the actual content, or the raw text if no braces.
  const first = text.indexOf('{');
  if (first !== -1 && end > first) return text.slice(first, end + 1);
  return text;
}

export async function completeStructured<T>(
  llm: LLM,
  opts: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 3));
  const schemaDescription = describeSchema(opts.schema);
  const basePrompt = [
    opts.prompt,
    '',
    `Respond with a JSON object matching this JSON Schema: ${schemaDescription}`,
    'Return ONLY JSON, with no markdown fences or commentary.',
  ].join('\n');

  let prompt = basePrompt;
  let tokensIn = 0;
  let tokensOut = 0;
  let lastErrors: unknown = undefined;
  let lastText = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const completion = await llm.complete({
      system: opts.system,
      prompt,
      json: true,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
    tokensIn += completion.tokensIn;
    tokensOut += completion.tokensOut;
    lastText = completion.text;

    const jsonText = extractJsonText(completion.text);
    let parsed: unknown;
    let repairReason: string;
    try {
      parsed = JSON.parse(jsonText);
      const result = opts.schema.safeParse(parsed);
      if (result.success) {
        return { value: result.data, attempts: attempt, tokensIn, tokensOut };
      }
      lastErrors = z.flattenError(result.error);
      repairReason = `Your previous response failed validation: ${JSON.stringify(lastErrors)}`;
    } catch (err) {
      lastErrors = { jsonParse: err instanceof Error ? err.message : String(err) };
      repairReason = `Your previous response was not valid JSON (${
        err instanceof Error ? err.message : String(err)
      })`;
    }

    prompt = [
      basePrompt,
      '',
      repairReason,
      'Previous response (may be truncated):',
      excerptOf(completion.text),
      '',
      'Return ONLY the corrected JSON.',
    ].join('\n');
  }

  throw new StructuredOutputError({ attempts: maxAttempts, lastErrors, lastText });
}
