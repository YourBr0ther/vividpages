import { randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GenerateOptions, ImageGen, ImageResult } from './types';

/** A ComfyUI API-format workflow graph: node id → node. */
export interface WorkflowNode {
  class_type: string;
  _meta?: { title?: string };
  inputs: Record<string, unknown>;
}
export type WorkflowGraph = Record<string, WorkflowNode>;

/**
 * Minimal Z-Image Turbo text-to-image graph. Patch points are identified by
 * node TITLE (_meta.title), never by node id: 'checkpoint', 'positive',
 * 'negative', 'latent', 'sampler', 'save'.
 *
 * Settings mirror the official ComfyUI 'image_z_image_turbo' template
 * (v0.9.98): EmptySD3LatentImage latents, KSampler res_multistep/simple,
 * 8 steps, cfg 1, denoise 1.
 */
export const ZIMAGE_T2I_TEMPLATE: WorkflowGraph = JSON.parse(
  readFileSync(new URL('./workflows/zimage-t2i.json', import.meta.url), 'utf8'),
) as WorkflowGraph;

export class ComfyUIError extends Error {
  /**
   * 'NETWORK'      — the server could not be reached (fetch failed).
   * 'TIMEOUT'      — the overall generation deadline elapsed.
   * 'EXECUTION'    — the workflow ran and a node failed.
   * 'BAD_RESPONSE' — non-2xx HTTP, malformed payloads, or a graph/template
   *                  that cannot be patched.
   */
  readonly code: 'NETWORK' | 'TIMEOUT' | 'EXECUTION' | 'BAD_RESPONSE';

  constructor(code: ComfyUIError['code'], detail: string) {
    super(detail);
    this.name = 'ComfyUIError';
    this.code = code;
  }
}

/** Crypto-safe random seed in [0, 2^53): 32 high bits + 21 low bits. */
export function randomSeed(): number {
  const words = webcrypto.getRandomValues(new Uint32Array(2));
  return words[0]! * 2 ** 21 + (words[1]! >>> 11);
}

export interface PatchParams {
  checkpoint: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
}

/**
 * Returns a deep-cloned copy of `template` with generation parameters patched
 * into the nodes identified by their `_meta.title`. The input template is
 * never mutated. Throws ComfyUIError('BAD_RESPONSE') when an expected title
 * is missing — that means the checked-in template and this code disagree.
 */
export function patchWorkflow(template: WorkflowGraph, params: PatchParams): WorkflowGraph {
  const graph = structuredClone(template);
  const byTitle = (title: string): WorkflowNode => {
    const node = Object.values(graph).find((n) => n._meta?.title === title);
    if (!node) {
      throw new ComfyUIError(
        'BAD_RESPONSE',
        `workflow template has no node titled '${title}'`,
      );
    }
    return node;
  };

  byTitle('checkpoint').inputs.ckpt_name = params.checkpoint;
  byTitle('positive').inputs.text = params.prompt;
  byTitle('negative').inputs.text = params.negative;
  const latent = byTitle('latent');
  latent.inputs.width = params.width;
  latent.inputs.height = params.height;
  const sampler = byTitle('sampler');
  sampler.inputs.seed = params.seed;
  sampler.inputs.steps = params.steps;
  sampler.inputs.cfg = params.cfg;
  byTitle('save'); // assert the output node exists up front
  return graph;
}

export interface ComfyUIImageGenOptions {
  baseUrl: string;
  /** Checkpoint filename on the server. Default Z-Image Turbo AIO. */
  checkpoint?: string;
  defaultSteps?: number;
  defaultCfg?: number;
  /** Overall per-generate deadline. Default 300_000. */
  timeoutMs?: number;
  /** History polling interval. Default 1500. */
  pollIntervalMs?: number;
}

interface HistoryEntry {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, Record<string, unknown>]>;
  };
  outputs?: Record<
    string,
    { images?: Array<{ filename?: string; subfolder?: string; type?: string }> }
  >;
}

const DEFAULT_CHECKPOINT = 'z-image-turbo-fp8-aio.safetensors';

export class ComfyUIImageGen implements ImageGen {
  readonly provider = 'comfyui';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly checkpoint: string;
  private readonly defaultSteps: number;
  private readonly defaultCfg: number;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(opts: ComfyUIImageGenOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.checkpoint = opts.checkpoint ?? DEFAULT_CHECKPOINT;
    this.model = this.checkpoint;
    this.defaultSteps = opts.defaultSteps ?? 8;
    this.defaultCfg = opts.defaultCfg ?? 1;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
  }

  async generate(opts: GenerateOptions): Promise<ImageResult> {
    const startedAt = Date.now();
    const deadline = startedAt + this.timeoutMs;
    const params: PatchParams = {
      checkpoint: this.checkpoint,
      prompt: opts.prompt,
      negative: opts.negative ?? '',
      width: opts.width ?? 1024,
      height: opts.height ?? 1024,
      seed: opts.seed ?? randomSeed(),
      steps: opts.steps ?? this.defaultSteps,
      cfg: opts.cfg ?? this.defaultCfg,
    };
    const graph = patchWorkflow(ZIMAGE_T2I_TEMPLATE, params);

    const promptId = await this.enqueue(graph, deadline);
    const entry = await this.pollHistory(promptId, deadline);
    const png = await this.downloadOutput(entry, promptId, deadline);

    return {
      png,
      seed: params.seed,
      width: params.width,
      height: params.height,
      durationMs: Date.now() - startedAt,
      params: { provider: this.provider, ...params },
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const stats = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!stats.ok) {
        return { ok: false, detail: `GET /system_stats returned ${stats.status}` };
      }
      const info = await fetch(`${this.baseUrl}/object_info/CheckpointLoaderSimple`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!info.ok) {
        return {
          ok: false,
          detail: `GET /object_info/CheckpointLoaderSimple returned ${info.status}`,
        };
      }
      const data = (await info.json()) as {
        CheckpointLoaderSimple?: {
          input?: { required?: { ckpt_name?: [string[], unknown] } };
        };
      };
      const available =
        data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
      if (!available.includes(this.checkpoint)) {
        return {
          ok: false,
          detail: `checkpoint '${this.checkpoint}' not installed on server (available: ${available.join(', ') || 'none'})`,
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async enqueue(graph: WorkflowGraph, deadline: number): Promise<string> {
    const res = await this.request(`/prompt`, deadline, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ComfyUIError(
        'BAD_RESPONSE',
        `POST /prompt failed (${res.status}): ${body.slice(0, 500)}`,
      );
    }
    const data = (await res.json().catch(() => ({}))) as { prompt_id?: string };
    if (typeof data.prompt_id !== 'string' || data.prompt_id === '') {
      throw new ComfyUIError(
        'BAD_RESPONSE',
        `POST /prompt response did not include a prompt_id: ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
    return data.prompt_id;
  }

  private async pollHistory(promptId: string, deadline: number): Promise<HistoryEntry> {
    for (;;) {
      const res = await this.request(`/history/${promptId}`, deadline);
      if (!res.ok) {
        throw new ComfyUIError(
          'BAD_RESPONSE',
          `GET /history/${promptId} failed (${res.status})`,
        );
      }
      const history = (await res.json().catch(() => ({}))) as Record<string, HistoryEntry>;
      const entry = history[promptId];
      if (entry) {
        const status = entry.status ?? {};
        if (status.status_str === 'error') {
          throw new ComfyUIError('EXECUTION', this.describeExecutionError(status));
        }
        const hasOutputs = Object.keys(entry.outputs ?? {}).length > 0;
        if (status.completed || hasOutputs) return entry;
      }
      if (Date.now() + this.pollIntervalMs > deadline) {
        const queueDetail = await this.describeQueuePosition(promptId);
        throw new ComfyUIError(
          'TIMEOUT',
          `generation did not complete within ${this.timeoutMs}ms (prompt ${promptId}${queueDetail})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private describeExecutionError(status: NonNullable<HistoryEntry['status']>): string {
    const errors = (status.messages ?? [])
      .filter(([kind]) => kind === 'execution_error')
      .map(([, detail]) => {
        const nodeType = detail.node_type ?? 'unknown node';
        const nodeId = detail.node_id ?? '?';
        const message = detail.exception_message ?? 'unknown error';
        return `${String(nodeType)} (node ${String(nodeId)}): ${String(message)}`;
      });
    return `workflow execution failed: ${errors.join('; ') || status.status_str || 'unknown error'}`;
  }

  /** Best-effort queue context for timeout errors; never throws. */
  private async describeQueuePosition(promptId: string): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/queue`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return '';
      const data = (await res.json()) as {
        queue_running?: unknown[][];
        queue_pending?: unknown[][];
      };
      const running = data.queue_running ?? [];
      const pending = data.queue_pending ?? [];
      if (running.some((item) => item[1] === promptId)) {
        return ', currently executing';
      }
      const index = pending.findIndex((item) => item[1] === promptId);
      if (index >= 0) {
        return `, queue position ${index + 1} of ${pending.length} pending (${running.length} running)`;
      }
      return '';
    } catch {
      return '';
    }
  }

  private async downloadOutput(
    entry: HistoryEntry,
    promptId: string,
    deadline: number,
  ): Promise<Buffer> {
    const image = Object.values(entry.outputs ?? {})
      .flatMap((output) => output.images ?? [])
      .find((img) => typeof img.filename === 'string' && img.filename !== '');
    if (!image) {
      throw new ComfyUIError(
        'BAD_RESPONSE',
        `prompt ${promptId} completed but history contains no image outputs`,
      );
    }
    const query = new URLSearchParams({
      filename: image.filename!,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    });
    const res = await this.request(`/view?${query}`, deadline);
    if (!res.ok) {
      throw new ComfyUIError(
        'BAD_RESPONSE',
        `GET /view for '${image.filename}' failed (${res.status})`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** fetch with deadline-aware timeout, mapping failures to NETWORK/TIMEOUT. */
  private async request(path: string, deadline: number, init?: RequestInit): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new ComfyUIError(
        'TIMEOUT',
        `deadline of ${this.timeoutMs}ms exceeded before ${path}`,
      );
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(remaining),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ComfyUIError(
          'TIMEOUT',
          `request to ${path} timed out (overall deadline ${this.timeoutMs}ms)`,
        );
      }
      const cause =
        err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : '';
      const detail = err instanceof Error ? err.message : String(err);
      throw new ComfyUIError(
        'NETWORK',
        `ComfyUI request to ${this.baseUrl}${path} failed (${detail}${cause})`,
      );
    }
  }
}
