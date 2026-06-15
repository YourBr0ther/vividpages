import { describe, expect, it, vi } from 'vitest';
import { OpenAIEmbedder } from '../src/embed/openai';
import { OpenAIError } from '../src/openai/error';

function fakeClient(createImpl: (body: { input: string[] }) => unknown) {
  const create = vi.fn(async (body: { input: string[] }) => createImpl(body));
  return { client: { embeddings: { create } }, create };
}

/** Builds a deterministic embeddings response in `index` order. */
function embedResponse(vectors: number[][], usage = { prompt_tokens: 5 }) {
  return {
    data: vectors.map((embedding, index) => ({ index, embedding })),
    usage,
  };
}

describe('OpenAIEmbedder', () => {
  it('reports text-embedding-3-small @ 1536 dims', () => {
    const { client } = fakeClient(() => embedResponse([]));
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never });
    expect(e.provider).toBe('openai');
    expect(e.model).toBe('text-embedding-3-small');
    expect(e.dimensions).toBe(1536);
  });

  it('returns [] for empty input without calling the API', async () => {
    const { client, create } = fakeClient(() => embedResponse([]));
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never });
    expect(await e.embed([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('embeds a batch in one request and preserves input order', async () => {
    const { client, create } = fakeClient(() =>
      embedResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ]),
    );
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never });
    const out = await e.embed(['a', 'b']);
    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toEqual(['a', 'b']);
  });

  it('reorders out-of-order responses by index', async () => {
    const { client } = fakeClient(() => ({
      data: [
        { index: 1, embedding: [9, 9] },
        { index: 0, embedding: [1, 1] },
      ],
      usage: { prompt_tokens: 2 },
    }));
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never });
    expect(await e.embed(['x', 'y'])).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });

  it('chunks large input into batches of batchSize', async () => {
    const { client, create } = fakeClient((body) =>
      embedResponse(body.input.map((_, i) => [i])),
    );
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never, batchSize: 2 });
    const out = await e.embed(['a', 'b', 'c', 'd', 'e']);
    expect(create).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(out).toHaveLength(5);
  });

  it('throws OpenAIError when the API returns the wrong count', async () => {
    const { client } = fakeClient(() => embedResponse([[1, 2]])); // only 1 for 2 inputs
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never });
    await expect(e.embed(['a', 'b'])).rejects.toBeInstanceOf(OpenAIError);
  });

  it('maps SDK errors to OpenAIError', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('bad'), { status: 401, type: 'authentication_error' });
    });
    const e = new OpenAIEmbedder({ apiKey: 'k', client: client as never });
    const err = await e.embed(['a']).then(
      () => {
        throw new Error('expected rejection');
      },
      (x: unknown) => x,
    );
    expect(err).toBeInstanceOf(OpenAIError);
    expect((err as OpenAIError).status).toBe(401);
  });

  it('requires apiKey', () => {
    expect(() => new OpenAIEmbedder({ apiKey: '' })).toThrow(OpenAIError);
  });
});
