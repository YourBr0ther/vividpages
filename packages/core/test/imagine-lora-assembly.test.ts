import { describe, expect, it, vi } from 'vitest';

import { assembleSceneLoras, resolveCharacterLora } from '../src/pipeline/imagine';

describe('resolveCharacterLora', () => {
  it('returns null when loraName is null (no LoRA = today\'s behavior)', () => {
    expect(resolveCharacterLora({ loraName: null, loraStrength: 1.0 })).toBeNull();
  });

  it('returns null when loraName is blank/whitespace', () => {
    expect(resolveCharacterLora({ loraName: '   ', loraStrength: 1.0 })).toBeNull();
  });

  it('applies the given strength to both model and clip', () => {
    expect(resolveCharacterLora({ loraName: 'StyleA.safetensors', loraStrength: 0.8 })).toEqual({
      name: 'StyleA.safetensors',
      strengthModel: 0.8,
      strengthClip: 0.8,
    });
  });

  it('defaults strength to 1.0 when loraStrength is null', () => {
    expect(resolveCharacterLora({ loraName: 'StyleA.safetensors', loraStrength: null })).toEqual({
      name: 'StyleA.safetensors',
      strengthModel: 1.0,
      strengthClip: 1.0,
    });
  });

  it('trims the lora name', () => {
    expect(resolveCharacterLora({ loraName: '  L.safetensors  ', loraStrength: 1.0 })?.name).toBe(
      'L.safetensors',
    );
  });
});

describe('assembleSceneLoras', () => {
  it('returns [] for an all-no-LoRA cast (byte-identical no-LoRA path)', () => {
    const cast = [
      { loraName: null, loraStrength: null },
      { loraName: null, loraStrength: 1.0 },
    ];
    expect(assembleSceneLoras(cast)).toEqual([]);
  });

  it('collects each present LoRA with default and explicit strengths', () => {
    const cast = [
      { loraName: 'A.safetensors', loraStrength: null },
      { loraName: 'B.safetensors', loraStrength: 0.6 },
    ];
    expect(assembleSceneLoras(cast)).toEqual([
      { name: 'A.safetensors', strengthModel: 1.0, strengthClip: 1.0 },
      { name: 'B.safetensors', strengthModel: 0.6, strengthClip: 0.6 },
    ]);
  });

  it('dedupes by name (same LoRA used once, first strength wins)', () => {
    const cast = [
      { loraName: 'Same.safetensors', loraStrength: 0.9 },
      { loraName: 'Same.safetensors', loraStrength: 0.2 },
      { loraName: 'Other.safetensors', loraStrength: 1.0 },
    ];
    expect(assembleSceneLoras(cast)).toEqual([
      { name: 'Same.safetensors', strengthModel: 0.9, strengthClip: 0.9 },
      { name: 'Other.safetensors', strengthModel: 1.0, strengthClip: 1.0 },
    ]);
  });

  it('caps the chain at 3 distinct LoRAs keeping the most prominent (input order)', () => {
    const cast = [
      { loraName: 'A.safetensors', loraStrength: 1.0 },
      { loraName: 'B.safetensors', loraStrength: 1.0 },
      { loraName: 'C.safetensors', loraStrength: 1.0 },
      { loraName: 'D.safetensors', loraStrength: 1.0 },
    ];
    const onDrop = vi.fn();
    const result = assembleSceneLoras(cast, onDrop);
    expect(result.map((l) => l.name)).toEqual([
      'A.safetensors',
      'B.safetensors',
      'C.safetensors',
    ]);
    expect(onDrop).toHaveBeenCalledWith(['D.safetensors']);
  });

  it('does not invoke onDrop when within the cap', () => {
    const onDrop = vi.fn();
    assembleSceneLoras([{ loraName: 'A.safetensors', loraStrength: 1.0 }], onDrop);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('counts distinct LoRAs (not characters) toward the cap', () => {
    // 4 characters but only 3 distinct LoRAs → no drop.
    const cast = [
      { loraName: 'A.safetensors', loraStrength: 1.0 },
      { loraName: 'A.safetensors', loraStrength: 1.0 },
      { loraName: 'B.safetensors', loraStrength: 1.0 },
      { loraName: 'C.safetensors', loraStrength: 1.0 },
    ];
    const onDrop = vi.fn();
    const result = assembleSceneLoras(cast, onDrop);
    expect(result.map((l) => l.name)).toEqual([
      'A.safetensors',
      'B.safetensors',
      'C.safetensors',
    ]);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
