import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AnthropicError, AnthropicLLM } from '../src/llm/anthropic';
import { completeStructured, StructuredOutputError } from '../src/structured';

/**
 * Builds a fake Anthropic SDK client whose `messages.create` is a vi.fn and
 * `models.list` resolves. The adapter accepts an injected client so we never
 * make a live call.
 */
function fakeClient(createImpl: (body: unknown) => unknown) {
  const create = vi.fn(async (body: unknown) => createImpl(body));
  const list = vi.fn(async () => ({ data: [{ id: 'claude-sonnet-4-6' }] }));
  return { client: { messages: { create }, models: { list } }, create, list };
}

function textResponse(text: string, usage = { input_tokens: 11, output_tokens: 22 }) {
  return { content: [{ type: 'text', text }], usage };
}

function toolResponse(input: unknown, usage = { input_tokens: 30, output_tokens: 40 }) {
  return {
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'emit', input }],
    usage,
  };
}

describe('AnthropicLLM', () => {
  it('defaults to claude-sonnet-4-6 and reports provider', () => {
    const { client } = fakeClient(() => textResponse('hi'));
    const llm = new AnthropicLLM({ apiKey: 'sk-ant-x', client: client as never });
    expect(llm.provider).toBe('anthropic');
    expect(llm.model).toBe('claude-sonnet-4-6');
  });

  it('honors an explicit model', () => {
    const { client } = fakeClient(() => textResponse('hi'));
    const llm = new AnthropicLLM({
      apiKey: 'k',
      model: 'claude-opus-4-8',
      client: client as never,
    });
    expect(llm.model).toBe('claude-opus-4-8');
  });

  it('plain text completion: maps text + token usage, no tools sent', async () => {
    const { client, create } = fakeClient(() => textResponse('Bonjour', {
      input_tokens: 5,
      output_tokens: 7,
    }));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const out = await llm.complete({ prompt: 'Hello in French?' });

    expect(out.text).toBe('Bonjour');
    expect(out.tokensIn).toBe(5);
    expect(out.tokensOut).toBe(7);

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello in French?' }]);
  });

  it('passes system, maxTokens through', async () => {
    const { client, create } = fakeClient(() => textResponse('ok'));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    await llm.complete({ system: 'Be terse.', prompt: 'hi', maxTokens: 1234 });
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.system).toBe('Be terse.');
    expect(body.max_tokens).toBe(1234);
  });

  it('jsonSchema present: registers a forced tool and returns stringified tool input', async () => {
    const schema = {
      type: 'object',
      properties: { animal: { type: 'string' }, legs: { type: 'number' } },
      required: ['animal', 'legs'],
    };
    const { client, create } = fakeClient(() => toolResponse({ animal: 'spider', legs: 8 }));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const out = await llm.complete({ prompt: 'describe', jsonSchema: schema });

    // Returned text is JSON.stringify(tool_use.input) so completeStructured parses it.
    expect(JSON.parse(out.text)).toEqual({ animal: 'spider', legs: 8 });
    expect(out.tokensIn).toBe(30);
    expect(out.tokensOut).toBe(40);

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.input_schema).toEqual(schema);
    const toolName = tools[0]!.name as string;
    expect(body.tool_choice).toEqual({ type: 'tool', name: toolName });
  });

  it('json:true (no schema) requests a JSON object via system instruction, returns text', async () => {
    const { client, create } = fakeClient(() => textResponse('{"a":1}'));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const out = await llm.complete({ prompt: 'give json', json: true });
    expect(out.text).toBe('{"a":1}');
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    // No forced tool when there is no schema.
    expect(body.tools).toBeUndefined();
  });

  it('throws AnthropicError mapping status + type on SDK error', async () => {
    const sdkErr = Object.assign(new Error('bad key'), {
      status: 401,
      type: 'authentication_error',
    });
    const { client } = fakeClient(() => {
      throw sdkErr;
    });
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const err = await llm.complete({ prompt: 'x' }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AnthropicError);
    expect((err as AnthropicError).status).toBe(401);
    expect((err as AnthropicError).code).toBe('authentication_error');
  });

  it('healthCheck ok when models.list resolves', async () => {
    const { client } = fakeClient(() => textResponse('hi'));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    expect(await llm.healthCheck()).toEqual({ ok: true });
  });

  it('healthCheck not ok with detail when models.list throws', async () => {
    const { client, list } = fakeClient(() => textResponse('hi'));
    list.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 403 }));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const res = await llm.healthCheck();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('nope');
  });

  it('round-trips through completeStructured with bad-then-good repair', async () => {
    const animalSchema = z.object({ animal: z.string(), legs: z.number() });
    // First call: tool returns invalid (legs is a string). Second: valid.
    let call = 0;
    const { client } = fakeClient(() => {
      call += 1;
      return call === 1
        ? toolResponse({ animal: 'spider', legs: 'eight' })
        : toolResponse({ animal: 'spider', legs: 8 });
    });
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.attempts).toBe(2);
    expect(result.value).toEqual({ animal: 'spider', legs: 8 });
  });

  it('completeStructured surfaces StructuredOutputError after exhausting attempts', async () => {
    const animalSchema = z.object({ animal: z.string(), legs: z.number() });
    const { client } = fakeClient(() => toolResponse({ animal: 'spider', legs: 'no' }));
    const llm = new AnthropicLLM({ apiKey: 'k', client: client as never });
    const err = await completeStructured(llm, {
      prompt: 'x',
      schema: animalSchema,
      maxAttempts: 2,
    }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StructuredOutputError);
  });

  it('requires an apiKey', () => {
    expect(() => new AnthropicLLM({ apiKey: '' })).toThrow(AnthropicError);
  });
});
