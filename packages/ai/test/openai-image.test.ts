import { describe, expect, it, vi } from 'vitest';
import { mapToSupportedSize, OpenAIImageGen } from '../src/image/openai';
import { OpenAIError } from '../src/openai/error';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B64 = PNG_BYTES.toString('base64');

function fakeClient(generateImpl: (body: unknown) => unknown) {
  const generate = vi.fn(async (body: unknown) => generateImpl(body));
  const list = vi.fn(async () => ({ data: [{ id: 'gpt-image-1' }] }));
  return { client: { images: { generate }, models: { list } }, generate, list };
}

function imageResponse(b64 = PNG_B64) {
  return { data: [{ b64_json: b64 }] };
}

describe('mapToSupportedSize', () => {
  it('square-ish -> 1024x1024', () => {
    expect(mapToSupportedSize(1024, 1024)).toBe('1024x1024');
    expect(mapToSupportedSize(900, 1000)).toBe('1024x1024');
  });
  it('portrait -> 1024x1536', () => {
    expect(mapToSupportedSize(768, 1344)).toBe('1024x1536');
  });
  it('landscape -> 1536x1024', () => {
    expect(mapToSupportedSize(1344, 768)).toBe('1536x1024');
  });
});

describe('OpenAIImageGen', () => {
  it('reports gpt-image-1 @ provider openai', () => {
    const { client } = fakeClient(() => imageResponse());
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    expect(g.provider).toBe('openai');
    expect(g.model).toBe('gpt-image-1');
  });

  it('decodes b64_json into a PNG Buffer', async () => {
    const { client, generate } = fakeClient(() => imageResponse());
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    const res = await g.generate({ prompt: 'a fox', width: 1024, height: 1024 });
    expect(Buffer.isBuffer(res.png)).toBe(true);
    expect(res.png.equals(PNG_BYTES)).toBe(true);

    const body = generate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('gpt-image-1');
    expect(body.prompt).toBe('a fox');
    expect(body.size).toBe('1024x1024');
  });

  it('maps requested size to the nearest supported size', async () => {
    const { client, generate } = fakeClient(() => imageResponse());
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    const res = await g.generate({ prompt: 'tall', width: 768, height: 1344 });
    const body = generate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.size).toBe('1024x1536');
    // The returned width/height reflect the actually-generated (mapped) size.
    expect(res.width).toBe(1024);
    expect(res.height).toBe(1536);
  });

  it('ignores negative prompt and seed (not forwarded) and echoes seed -1', async () => {
    const { client, generate } = fakeClient(() => imageResponse());
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    const res = await g.generate({
      prompt: 'a fox',
      negative: 'blurry, watermark',
      seed: 12345,
    });
    const body = generate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.negative).toBeUndefined();
    expect(body.negative_prompt).toBeUndefined();
    expect(body.seed).toBeUndefined();
    // gpt-image-1 offers no seed control; we echo -1 to signal "not reproducible".
    expect(res.seed).toBe(-1);
    // params record the limitation for provenance.
    expect(res.params.negativeIgnored).toBe(true);
    expect(res.params.seedControlled).toBe(false);
  });

  it('records provider + size in params', async () => {
    const { client } = fakeClient(() => imageResponse());
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    const res = await g.generate({ prompt: 'x', width: 1344, height: 768 });
    expect(res.params.provider).toBe('openai');
    expect(res.params.model).toBe('gpt-image-1');
    expect(res.params.size).toBe('1536x1024');
  });

  it('throws OpenAIError when no image data is returned', async () => {
    const { client } = fakeClient(() => ({ data: [] }));
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    await expect(g.generate({ prompt: 'x' })).rejects.toBeInstanceOf(OpenAIError);
  });

  it('maps SDK errors to OpenAIError', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('content policy'), {
        status: 400,
        type: 'invalid_request_error',
      });
    });
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    const err = await g.generate({ prompt: 'x' }).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OpenAIError);
    expect((err as OpenAIError).status).toBe(400);
  });

  it('healthCheck ok / not-ok', async () => {
    const { client, list } = fakeClient(() => imageResponse());
    const g = new OpenAIImageGen({ apiKey: 'k', client: client as never });
    expect(await g.healthCheck()).toEqual({ ok: true });
    list.mockRejectedValueOnce(new Error('boom'));
    expect((await g.healthCheck()).ok).toBe(false);
  });

  it('requires apiKey', () => {
    expect(() => new OpenAIImageGen({ apiKey: '' })).toThrow(OpenAIError);
  });
});
