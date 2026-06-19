import { describe, expect, it } from 'vitest';

import {
  clampSingleBase,
  composeBodyModel,
  dedupeOutfits,
  stripTransientStates,
  type RawOutfit,
} from '../src/characters/wardrobe';
import type { CharacterProfile } from '../src/analysis/profile-schema';

const baseProfile: CharacterProfile = {
  hair: 'lavender hair',
  eyes: 'hazel eyes',
  skin: 'fair skin',
  build: 'slender build',
  age: 'young woman',
  attire: 'practical work dress',
  distinguishing: 'ink-stained fingers',
  oneLine: 'young woman with lavender hair in a work dress',
  role: 'main',
};

describe('composeBodyModel', () => {
  it('composes a clothing-stripped descriptor from structured fields', () => {
    // attire MUST be excluded; physical fields included in stable order.
    expect(composeBodyModel(baseProfile)).toBe(
      'young woman, slender build, fair skin, lavender hair, hazel eyes, ink-stained fingers',
    );
  });

  it('never includes the attire field even when other fields are null', () => {
    const profile: CharacterProfile = {
      ...baseProfile,
      hair: null,
      eyes: null,
      skin: null,
      build: null,
      age: null,
      distinguishing: null,
      attire: 'a long red ballgown',
    };
    expect(composeBodyModel(profile)).toBe('');
  });

  it('skips null fields, preserving order of present ones', () => {
    const profile: CharacterProfile = {
      ...baseProfile,
      skin: null,
      distinguishing: null,
    };
    expect(composeBodyModel(profile)).toBe(
      'young woman, slender build, lavender hair, hazel eyes',
    );
  });

  it('is deterministic: identical input yields identical output', () => {
    expect(composeBodyModel(baseProfile)).toBe(composeBodyModel({ ...baseProfile }));
  });

  it('strips clothing words that leak into a physical trait field', () => {
    // The spike showed the LLM leaks attire into "immutable" fields; guard it.
    const profile: CharacterProfile = {
      ...baseProfile,
      distinguishing: 'ink-stained fingers, wearing a green cloak',
    };
    expect(composeBodyModel(profile)).not.toContain('cloak');
    expect(composeBodyModel(profile)).toContain('ink-stained fingers');
  });

  it('strips transient injuries that the profiler stored in a body field', () => {
    // Live data: "gash on his forehead" leaked into distinguishing.
    const profile: CharacterProfile = {
      ...baseProfile,
      distinguishing: 'a gash on his forehead, a permanent scar tattoo',
    };
    const out = composeBodyModel(profile);
    expect(out).not.toContain('gash');
    expect(out).toContain('permanent scar tattoo');
  });

  it('keeps pale/flushed as legitimate skin descriptors', () => {
    const profile: CharacterProfile = { ...baseProfile, skin: 'pale skin' };
    expect(composeBodyModel(profile)).toContain('pale skin');
  });

  it('returns empty string for an all-null profile', () => {
    const profile: CharacterProfile = {
      hair: null,
      eyes: null,
      skin: null,
      build: null,
      age: null,
      attire: null,
      distinguishing: null,
      oneLine: 'someone',
      role: 'minor',
    };
    expect(composeBodyModel(profile)).toBe('');
  });
});

describe('stripTransientStates', () => {
  it('drops a signal that is purely an injury', () => {
    expect(stripTransientStates('a bleeding gash on her arm')).toBeNull();
    expect(stripTransientStates('bruised and battered')).toBeNull();
  });

  it('drops wetness/dirt/sweat states', () => {
    expect(stripTransientStates('soaked to the bone')).toBeNull();
    expect(stripTransientStates('clothes wet and muddy')).toBeNull();
    expect(stripTransientStates('drenched in sweat')).toBeNull();
  });

  it('drops mood/emotion and grooming-state deltas', () => {
    expect(stripTransientStates('looking furious')).toBeNull();
    expect(stripTransientStates('hair tousled and messy')).toBeNull();
    expect(stripTransientStates('tear-streaked face')).toBeNull();
  });

  it('keeps a clean clothing signal untouched', () => {
    expect(stripTransientStates('a long green velvet cloak')).toBe('a long green velvet cloak');
    expect(stripTransientStates('navy military uniform with brass buttons')).toBe(
      'navy military uniform with brass buttons',
    );
  });

  it('strips a transient clause but keeps the clothing clause', () => {
    // "blood-soaked white shirt" -> the shirt is the outfit; "blood-soaked" is transient.
    const out = stripTransientStates('blood-soaked white shirt');
    expect(out).toBe('white shirt');
  });

  it('keeps clothing when the transient word is only part of a longer phrase', () => {
    const out = stripTransientStates('a torn and bloodied red gown');
    expect(out).toBe('red gown');
  });

  it('returns null for empty / whitespace input', () => {
    expect(stripTransientStates('')).toBeNull();
    expect(stripTransientStates('   ')).toBeNull();
  });
});

describe('dedupeOutfits', () => {
  it('merges near-duplicate descriptors, summing scene mentions', () => {
    const outfits: RawOutfit[] = [
      { descriptor: 'a long green cloak', sceneMentions: 3 },
      { descriptor: 'long green cloak', sceneMentions: 2 },
      { descriptor: 'navy uniform', sceneMentions: 5 },
    ];
    const merged = dedupeOutfits(outfits);
    expect(merged).toHaveLength(2);
    const cloak = merged.find((o) => o.descriptor.includes('cloak'));
    expect(cloak?.sceneMentions).toBe(5);
  });

  it('keeps the longer/more-detailed descriptor as canonical when merging', () => {
    const outfits: RawOutfit[] = [
      { descriptor: 'green cloak', sceneMentions: 1 },
      { descriptor: 'a long green velvet cloak', sceneMentions: 1 },
    ];
    const merged = dedupeOutfits(outfits);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.descriptor).toBe('a long green velvet cloak');
  });

  it('does not merge genuinely different outfits', () => {
    const outfits: RawOutfit[] = [
      { descriptor: 'navy military uniform', sceneMentions: 4 },
      { descriptor: 'red ballgown', sceneMentions: 2 },
    ];
    expect(dedupeOutfits(outfits)).toHaveLength(2);
  });

  it('drops empty descriptors', () => {
    const outfits: RawOutfit[] = [
      { descriptor: '', sceneMentions: 1 },
      { descriptor: '   ', sceneMentions: 1 },
      { descriptor: 'red dress', sceneMentions: 1 },
    ];
    const merged = dedupeOutfits(outfits);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.descriptor).toBe('red dress');
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeOutfits([])).toEqual([]);
  });
});

describe('clampSingleBase', () => {
  it('marks exactly one base: the max-mentions outfit', () => {
    const outfits: RawOutfit[] = [
      { descriptor: 'red dress', sceneMentions: 2 },
      { descriptor: 'navy uniform', sceneMentions: 7 },
      { descriptor: 'green cloak', sceneMentions: 3 },
    ];
    const states = clampSingleBase(outfits);
    const bases = states.filter((s) => s.isBase);
    expect(bases).toHaveLength(1);
    expect(bases[0]!.descriptor).toBe('navy uniform');
    expect(bases[0]!.type).toBe('base');
    for (const s of states.filter((s) => !s.isBase)) {
      expect(s.type).toBe('additional');
    }
  });

  it('breaks ties deterministically by descriptor order', () => {
    const outfits: RawOutfit[] = [
      { descriptor: 'b outfit', sceneMentions: 4 },
      { descriptor: 'a outfit', sceneMentions: 4 },
    ];
    const a = clampSingleBase(outfits);
    const b = clampSingleBase([...outfits].reverse());
    expect(a.find((s) => s.isBase)?.descriptor).toBe(b.find((s) => s.isBase)?.descriptor);
  });

  it('single outfit becomes the base', () => {
    const states = clampSingleBase([{ descriptor: 'only outfit', sceneMentions: 1 }]);
    expect(states).toHaveLength(1);
    expect(states[0]!.isBase).toBe(true);
    expect(states[0]!.type).toBe('base');
  });

  it('empty input yields no states', () => {
    expect(clampSingleBase([])).toEqual([]);
  });
});
