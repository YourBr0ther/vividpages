import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAIError, OpenAILLM } from '../src/llm/openai';
import { completeStructured } from '../src/structured';

function fakeClient(createImpl: (body: unknown) => unknown) {
  const create = vi.fn(async (body: unknown) => createImpl(body));
  const list = vi.fn(async () => ({ data: [{ id: 'gpt-4.1' }] }));
  return { client: { chat: { completions: { create } }, models: { list } }, create, list };
}

function chatResponse(content: string, usage = { prompt_tokens: 12, completion_tokens: 8 }) {
  return { choices: [{ message: { content } }], usage };
}

describe('OpenAILLM', () => {
  it('defaults model + provider', () => {
    const { client } = fakeClient(() => chatResponse('hi'));
    const llm = new OpenAILLM({ apiKey: 'sk-x', client: client as never });
    expect(llm.provider).toBe('openai');
    expect(llm.model).toBe('gpt-4.1');
  });

  it('plain text: maps content + tokens', async () => {
    const { client, create } = fakeClient(() =>
      chatResponse('Bonjour', { prompt_tokens: 3, completion_tokens: 4 }),
    );
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    const out = await llm.complete({ system: 'be terse', prompt: 'hi', maxTokens: 50 });
    expect(out.text).toBe('Bonjour');
    expect(out.tokensIn).toBe(3);
    expect(out.tokensOut).toBe(4);

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('gpt-4.1');
    expect(body.max_tokens).toBe(50);
    expect(body.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.response_format).toBeUndefined();
  });

  it('json:true sends response_format json_object', async () => {
    const { client, create } = fakeClient(() => chatResponse('{"a":1}'));
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    await llm.complete({ prompt: 'give json', json: true });
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('jsonSchema sends response_format json_schema (strict, with schema)', async () => {
    const schema = {
      type: 'object',
      properties: { animal: { type: 'string' } },
      required: ['animal'],
      additionalProperties: false,
    };
    const { client, create } = fakeClient(() => chatResponse('{"animal":"fox"}'));
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    const out = await llm.complete({ prompt: 'x', jsonSchema: schema });
    expect(out.text).toBe('{"animal":"fox"}');

    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    const rf = body.response_format as Record<string, unknown>;
    expect(rf.type).toBe('json_schema');
    const js = rf.json_schema as Record<string, unknown>;
    expect(js.strict).toBe(true);
    expect(js.schema).toEqual(schema);
    expect(typeof js.name).toBe('string');
  });

  it('maps SDK error to OpenAIError with status + type', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('rate limited'), {
        status: 429,
        type: 'rate_limit_error',
      });
    });
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    const err = await llm.complete({ prompt: 'x' }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OpenAIError);
    expect((err as OpenAIError).status).toBe(429);
    expect((err as OpenAIError).code).toBe('rate_limit_error');
  });

  it('healthCheck ok / not-ok', async () => {
    const { client, list } = fakeClient(() => chatResponse('hi'));
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    expect(await llm.healthCheck()).toEqual({ ok: true });
    list.mockRejectedValueOnce(new Error('boom'));
    const res = await llm.healthCheck();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('boom');
  });

  it('round-trips through completeStructured (bad-then-good)', async () => {
    const animalSchema = z.object({ animal: z.string(), legs: z.number() });
    let call = 0;
    const { client } = fakeClient(() => {
      call += 1;
      return chatResponse(
        call === 1 ? '{"animal":"spider","legs":"eight"}' : '{"animal":"spider","legs":8}',
      );
    });
    const llm = new OpenAILLM({ apiKey: 'k', client: client as never });
    const result = await completeStructured(llm, {
      prompt: 'Describe a spider',
      schema: animalSchema,
    });
    expect(result.attempts).toBe(2);
    expect(result.value).toEqual({ animal: 'spider', legs: 8 });
  });

  it('requires apiKey', () => {
    expect(() => new OpenAILLM({ apiKey: '' })).toThrow(OpenAIError);
  });
});
