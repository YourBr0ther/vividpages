import { describe, expect, it } from 'vitest';
import {
  applyLoras,
  patchWorkflow,
  ZIMAGE_T2I_TEMPLATE,
  type WorkflowGraph,
  type WorkflowNode,
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

function byTitle(graph: WorkflowGraph, title: string): [string, WorkflowNode] {
  const entry = Object.entries(graph).find(([, n]) => n._meta?.title === title);
  if (!entry) throw new Error(`no node titled '${title}' in graph`);
  return entry;
}

function loaderEntries(graph: WorkflowGraph): Array<[string, WorkflowNode]> {
  return Object.entries(graph).filter(([, n]) => n.class_type === 'LoraLoader');
}

describe('applyLoras', () => {
  it('returns the graph UNCHANGED (deep-equal) when loras is undefined', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    const before = structuredClone(patched);
    const result = applyLoras(patched, undefined);
    expect(result).toEqual(before);
  });

  it('returns the graph UNCHANGED (deep-equal) when loras is empty', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    const before = structuredClone(patched);
    const result = applyLoras(patched, []);
    expect(result).toEqual(before);
    // Byte-identical guarantee against the patched template (no-LoRA path).
    expect(JSON.stringify(result)).toBe(JSON.stringify(patched));
  });

  it('inserts one LoraLoader and repoints sampler + both CLIP encoders to it', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    const [checkpointId] = byTitle(patched, 'checkpoint');

    const result = applyLoras(patched, [
      { name: 'CharacterDesign.safetensors', strengthModel: 0.8, strengthClip: 0.8 },
    ]);

    const loaders = loaderEntries(result);
    expect(loaders).toHaveLength(1);
    const [loaderId, loader] = loaders[0]!;

    // LoaderLoader inputs: lora_name + strengths, chained off the checkpoint.
    expect(loader.inputs.lora_name).toBe('CharacterDesign.safetensors');
    expect(loader.inputs.strength_model).toBe(0.8);
    expect(loader.inputs.strength_clip).toBe(0.8);
    expect(loader.inputs.model).toEqual([checkpointId, 0]);
    expect(loader.inputs.clip).toEqual([checkpointId, 1]);

    // Consumers repointed to the (only/last) loader.
    expect(byTitle(result, 'sampler')[1].inputs.model).toEqual([loaderId, 0]);
    expect(byTitle(result, 'positive')[1].inputs.clip).toEqual([loaderId, 1]);
    expect(byTitle(result, 'negative')[1].inputs.clip).toEqual([loaderId, 1]);
  });

  it('chains two LoRAs: lora2 takes lora1 outputs; consumers point at lora2', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    const [checkpointId] = byTitle(patched, 'checkpoint');

    const result = applyLoras(patched, [
      { name: 'a.safetensors', strengthModel: 1, strengthClip: 1 },
      { name: 'b.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
    ]);

    const loaders = loaderEntries(result);
    expect(loaders).toHaveLength(2);
    const lora1 = loaders.find(([, n]) => n.inputs.lora_name === 'a.safetensors')!;
    const lora2 = loaders.find(([, n]) => n.inputs.lora_name === 'b.safetensors')!;

    // lora1 chains off the checkpoint.
    expect(lora1[1].inputs.model).toEqual([checkpointId, 0]);
    expect(lora1[1].inputs.clip).toEqual([checkpointId, 1]);
    // lora2 chains off lora1.
    expect(lora2[1].inputs.model).toEqual([lora1[0], 0]);
    expect(lora2[1].inputs.clip).toEqual([lora1[0], 1]);

    // Consumers point at the LAST loader (lora2).
    expect(byTitle(result, 'sampler')[1].inputs.model).toEqual([lora2[0], 0]);
    expect(byTitle(result, 'positive')[1].inputs.clip).toEqual([lora2[0], 1]);
    expect(byTitle(result, 'negative')[1].inputs.clip).toEqual([lora2[0], 1]);
  });

  it('assigns unique node ids that do not collide with existing ids', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    const existing = new Set(Object.keys(patched));

    const result = applyLoras(patched, [
      { name: 'a.safetensors', strengthModel: 1, strengthClip: 1 },
      { name: 'b.safetensors', strengthModel: 1, strengthClip: 1 },
      { name: 'c.safetensors', strengthModel: 1, strengthClip: 1 },
    ]);

    const ids = Object.keys(result);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    const loaderIds = loaderEntries(result).map(([id]) => id);
    expect(loaderIds).toHaveLength(3);
    for (const id of loaderIds) expect(existing.has(id)).toBe(false);
  });

  it('does not mutate the input template', () => {
    const patched = patchWorkflow(ZIMAGE_T2I_TEMPLATE, PATCH_PARAMS);
    const before = JSON.stringify(patched);
    const result = applyLoras(patched, [
      { name: 'a.safetensors', strengthModel: 1, strengthClip: 1 },
    ]);
    expect(JSON.stringify(patched)).toBe(before);
    expect(result).not.toBe(patched);
    // The original checkpoint still feeds the sampler in the untouched input.
    const [checkpointId] = byTitle(patched, 'checkpoint');
    expect(byTitle(patched, 'sampler')[1].inputs.model).toEqual([checkpointId, 0]);
  });
});
