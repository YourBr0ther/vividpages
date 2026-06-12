import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComfyUIError,
  ComfyUIImageGen,
  patchWorkflow,
  randomSeed,
  ZIMAGE_T2I_TEMPLATE,
  type WorkflowGraph,
} from '../src/image/comfyui';

const PATCH_PARAMS = {
  checkpoint: 'test-ckpt.safetensors',
  prompt: 'a fox',
  negative: 'blurry',
  width: 512,
  height: 768,
  seed: 42,
  steps: 8,
  cfg: 1,
};

function nodeByTitle(graph: WorkflowGraph, title: string) {
  const node = Object.values(graph).find((n) => n._meta?.title === title);
  if (!node) throw new Error(`no node titled '${title}' in graph`);
  return node;
}

describe('patchWorkflow', () => {
  it('patches every parameter into the node identified by its title', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);

    expect(nodeByTitle(patched, 'checkpoint').inputs.ckpt_name).toBe('test-ckpt.safetensors');
    expect(nodeByTitle(patched, 'positive').inputs.text).toBe('a fox');
    expect(nodeByTitle(patched, 'negative').inputs.text).toBe('blurry');
    expect(nodeByTitle(patched, 'latent').inputs.width).toBe(512);
    expect(nodeByTitle(patched, 'latent').inputs.height).toBe(768);
    const sampler = nodeByTitle(patched, 'sampler');
    expect(sampler.inputs.seed).toBe(42);
    expect(sampler.inputs.steps).toBe(8);
    expect(sampler.inputs.cfg).toBe(1);
  });

  it('locates nodes by title, not by node id', () => {
    // Same graph, completely different node ids.
    const renumbered: WorkflowGraph = Object.fromEntries(
      Object.entries(structuredClone(ZIMAGE_T2I_TEMPLATE)).map(([id, node], i) => [
        `node-${i + 100}`,
        node,
      ]),
    );
    // Re-wire links to the new ids so the graph stays internally consistent
    // (patchWorkflow does not validate links, but keep the fixture honest).
    const idMap = new Map(
      Object.keys(ZIMAGE_T2I_TEMPLATE).map((id, i) => [id, `node-${i + 100}`]),
    );
    for (const node of Object.values(renumbered)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && typeof value[0] === 'string' && idMap.has(value[0])) {
          node.inputs[key] = [idMap.get(value[0])!, value[1]];
        }
      }
    }

    const patched = patchWorkflow(renumbered, PATCH_PARAMS);
    expect(nodeByTitle(patched, 'positive').inputs.text).toBe('a fox');
    expect(nodeByTitle(patched, 'sampler').inputs.seed).toBe(42);
  });

  it('deep-clones: the input template is not mutated', () => {
    const before = JSON.stringify(ZIMAGE_T2I_TEMPLATE);
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    expect(JSON.stringify(ZIMAGE_T2I_TEMPLATE)).toBe(before);
    expect(patched).not.toBe(ZIMAGE_T2I_TEMPLATE);
    expect(nodeByTitle(ZIMAGE_T2I_TEMPLATE, 'positive').inputs.text).toBe('');
  });

  it('throws ComfyUIError when a required title is missing from the template', () => {
    const broken = structuredClone(ZIMAGE_T2I_TEMPLATE);
    const samplerId = Object.entries(broken).find(
      ([, n]) => n._meta?.title === 'sampler',
    )![0];
    delete broken[samplerId];

    expect(() => patchWorkflow(broken, PATCH_PARAMS)).toThrowError(ComfyUIError);
    try {
      patchWorkflow(broken, PATCH_PARAMS);
      expect.unreachable();
    } catch (err) {
      expect((err as ComfyUIError).code).toBe('BAD_RESPONSE');
      expect((err as ComfyUIError).message).toContain('sampler');
    }
  });
});

describe('randomSeed', () => {
  it('returns integers in [0, 2^53)', () => {
    for (let i = 0; i < 1000; i++) {
      const seed = randomSeed();
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 53);
    }
  });

  it('does not return the same value every time', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gen(overrides: Partial<ConstructorParameters<typeof ComfyUIImageGen>[0]> = {}) {
  return new ComfyUIImageGen({
    baseUrl: 'http://comfy.test',
    timeoutMs: 200,
    pollIntervalMs: 10,
    ...overrides,
  });
}

async function expectComfyError(
  promise: Promise<unknown>,
  code: ComfyUIError['code'],
): Promise<ComfyUIError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ComfyUIError);
    expect((err as ComfyUIError).code).toBe(code);
    return err as ComfyUIError;
  }
  expect.unreachable('expected promise to reject');
}

describe('ComfyUIImageGen error taxonomy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps unreachable server to NETWORK', async () => {
    mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expectComfyError(gen().generate({ prompt: 'x' }), 'NETWORK');
  });

  it('maps non-2xx enqueue to BAD_RESPONSE with body excerpt', async () => {
    mockFetch((url) => {
      if (url.includes('/prompt')) {
        return json({ error: { message: 'invalid prompt' } }, 400);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const err = await expectComfyError(gen().generate({ prompt: 'x' }), 'BAD_RESPONSE');
    expect(err.message).toContain('invalid prompt');
  });

  it('maps enqueue response without prompt_id to BAD_RESPONSE', async () => {
    mockFetch((url) => {
      if (url.includes('/prompt')) return json({ nope: true });
      throw new Error(`unexpected fetch: ${url}`);
    });
    await expectComfyError(gen().generate({ prompt: 'x' }), 'BAD_RESPONSE');
  });

  it('maps a history error status to EXECUTION with node error details', async () => {
    mockFetch((url) => {
      if (url.includes('/prompt')) return json({ prompt_id: 'p1' });
      if (url.includes('/history/p1')) {
        return json({
          p1: {
            status: {
              status_str: 'error',
              completed: false,
              messages: [
                ['execution_start', { prompt_id: 'p1' }],
                [
                  'execution_error',
                  {
                    node_id: '5',
                    node_type: 'KSampler',
                    exception_message: 'CUDA out of memory',
                  },
                ],
              ],
            },
            outputs: {},
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const err = await expectComfyError(gen().generate({ prompt: 'x' }), 'EXECUTION');
    expect(err.message).toContain('KSampler');
    expect(err.message).toContain('CUDA out of memory');
  });

  it('maps a never-completing history to TIMEOUT and includes queue position', async () => {
    mockFetch((url) => {
      if (url.includes('/prompt')) return json({ prompt_id: 'p1' });
      if (url.includes('/history/p1')) return json({});
      if (url.includes('/queue')) {
        return json({
          queue_running: [[0, 'other-prompt']],
          queue_pending: [
            [1, 'someone-else'],
            [2, 'p1'],
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const err = await expectComfyError(
      gen({ timeoutMs: 60 }).generate({ prompt: 'x' }),
      'TIMEOUT',
    );
    expect(err.message).toMatch(/queue position 2/i);
  });

  it('returns the decoded PNG and echoes seed and params on success', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fakebody'),
    ]);
    mockFetch((url) => {
      if (url.includes('/prompt')) return json({ prompt_id: 'p1' });
      if (url.includes('/history/p1')) {
        return json({
          p1: {
            status: { status_str: 'success', completed: true, messages: [] },
            outputs: {
              '7': {
                images: [{ filename: 'vp_0001.png', subfolder: 'sub', type: 'output' }],
              },
            },
          },
        });
      }
      if (url.includes('/view')) {
        expect(url).toContain('filename=vp_0001.png');
        expect(url).toContain('subfolder=sub');
        expect(url).toContain('type=output');
        return new Response(new Uint8Array(png), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await gen().generate({
      prompt: 'a fox',
      width: 512,
      height: 640,
      seed: 1234,
      steps: 6,
      cfg: 1.5,
    });
    expect(result.png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(result.seed).toBe(1234);
    expect(result.width).toBe(512);
    expect(result.height).toBe(640);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.params).toMatchObject({
      prompt: 'a fox',
      seed: 1234,
      steps: 6,
      cfg: 1.5,
    });
  });

  it('generates a random seed when absent and echoes it back', async () => {
    let sentSeed: number | undefined;
    mockFetch(async (url, init) => {
      if (url.includes('/prompt')) {
        const body = JSON.parse(String(init?.body)) as {
          prompt: WorkflowGraph;
        };
        const sampler = Object.values(body.prompt).find(
          (n) => n._meta?.title === 'sampler',
        )!;
        sentSeed = sampler.inputs.seed as number;
        return json({ prompt_id: 'p1' });
      }
      if (url.includes('/history/p1')) {
        return json({
          p1: {
            status: { status_str: 'success', completed: true, messages: [] },
            outputs: {
              '7': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
            },
          },
        });
      }
      if (url.includes('/view')) return new Response(new Uint8Array(8), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await gen().generate({ prompt: 'x' });
    expect(sentSeed).toBeDefined();
    expect(result.seed).toBe(sentSeed);
    expect(Number.isSafeInteger(result.seed)).toBe(true);
    expect(result.seed).toBeGreaterThanOrEqual(0);
    expect(result.seed).toBeLessThan(2 ** 53);
  });
});

describe('ComfyUIImageGen healthCheck', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is ok when system_stats responds and the checkpoint is installed', async () => {
    mockFetch((url) => {
      if (url.includes('/system_stats')) return json({ system: {} });
      if (url.includes('/object_info/CheckpointLoaderSimple')) {
        return json({
          CheckpointLoaderSimple: {
            input: {
              required: { ckpt_name: [['z-image-turbo-fp8-aio.safetensors'], {}] },
            },
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    expect(await gen().healthCheck()).toEqual({ ok: true });
  });

  it('reports a missing checkpoint with available alternatives', async () => {
    mockFetch((url) => {
      if (url.includes('/system_stats')) return json({ system: {} });
      if (url.includes('/object_info/CheckpointLoaderSimple')) {
        return json({
          CheckpointLoaderSimple: {
            input: { required: { ckpt_name: [['other-model.safetensors'], {}] } },
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const health = await gen().healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('z-image-turbo-fp8-aio.safetensors');
    expect(health.detail).toContain('other-model.safetensors');
  });

  it('reports an unreachable server', async () => {
    mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const health = await gen().healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toBeTruthy();
  });
});
