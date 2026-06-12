import { describe, expect, it } from 'vitest';

import {
  compileAppearanceToken,
  MAX_APPEARANCE_WORDS,
  sanitizeTraitValue,
  type AppearanceTraits,
} from '../src/characters/appearance';

const evie: AppearanceTraits = {
  age: 'young woman',
  build: 'slender build',
  skin: null,
  hair: 'lavender hair',
  eyes: 'hazel eyes',
  distinguishing: 'ink-stained fingers',
  attire: 'practical work dress',
};

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

describe('compileAppearanceToken', () => {
  it('joins fields in stable order, skipping nulls', () => {
    expect(compileAppearanceToken('Evie', evie)).toBe(
      'Evie: young woman, slender build, lavender hair, hazel eyes, ink-stained fingers, practical work dress',
    );
  });

  it('is deterministic: identical input produces identical output', () => {
    const a = compileAppearanceToken('Evie', { ...evie });
    const b = compileAppearanceToken('Evie', { ...evie });
    expect(a).toBe(b);
  });

  it('places skin between build and hair when present', () => {
    const token = compileAppearanceToken('Evie', { ...evie, skin: 'fair skin' });
    expect(token).toBe(
      'Evie: young woman, slender build, fair skin, lavender hair, hazel eyes, ' +
        'ink-stained fingers, practical work dress',
    );
  });

  it('lowercases trait fragments but preserves the name', () => {
    const token = compileAppearanceToken('Trystan Maverine', {
      hair: 'Dark Hair',
      eyes: 'Cold Grey Eyes',
    });
    expect(token).toBe('Trystan Maverine: dark hair, cold grey eyes');
  });

  it('returns just the name for an empty or null profile', () => {
    expect(compileAppearanceToken('Kingsley', {})).toBe('Kingsley');
    expect(compileAppearanceToken('Kingsley', null)).toBe('Kingsley');
    expect(
      compileAppearanceToken('Kingsley', {
        age: null,
        build: null,
        skin: null,
        hair: null,
        eyes: null,
        distinguishing: null,
        attire: null,
      }),
    ).toBe('Kingsley');
  });

  it('enforces the word cap by dropping whole fields, never truncating mid-field', () => {
    const traits: AppearanceTraits = {
      age: 'young woman',
      build: 'slender build',
      skin: 'fair freckled skin',
      hair: 'long wavy lavender hair always pinned up with a pair of silver pins',
      eyes: 'bright hazel eyes',
      distinguishing:
        'ink-stained fingers and a thin pale scar across the left palm from an old kitchen accident',
      attire: 'a practical and slightly threadbare grey work dress with deep pockets',
    };
    const token = compileAppearanceToken('Evie', traits);

    expect(wordCount(token)).toBeLessThanOrEqual(MAX_APPEARANCE_WORDS);
    // No mid-field truncation: every emitted fragment must be EXACTLY one of
    // the trait values (lowercased), never a cut-off prefix of one.
    const fragments = token.slice('Evie: '.length).split(', ');
    const wholeValues = Object.values(traits)
      .filter((v): v is string => Boolean(v))
      .map((v) => v.toLowerCase());
    for (const fragment of fragments) {
      expect(wholeValues).toContain(fragment);
    }
    // And at least something was dropped to satisfy the cap.
    expect(fragments.length).toBeLessThan(wholeValues.length);
  });

  it('whitespace-normalizes fragments', () => {
    const token = compileAppearanceToken('Blade', { hair: '  blond   hair \n' });
    expect(token).toBe('Blade: blond hair');
  });

  it('dedupes repeated fragments across fields, preserving first occurrence', () => {
    // Live data: 'gray beard, scars, gray beard, scars' (the model echoed the
    // same phrase into distinguishing AND attire).
    const token = compileAppearanceToken('Trystan', {
      distinguishing: 'gray beard, scars',
      attire: 'gray beard, scars',
    });
    expect(token).toBe('Trystan: gray beard, scars');
  });

  it('dedupes repeated fragments case-insensitively and within one field', () => {
    const token = compileAppearanceToken('Trystan', {
      hair: 'dark hair',
      distinguishing: 'Dark Hair, scars, dark hair',
    });
    expect(token).toBe('Trystan: dark hair, scars');
  });

  it('drops placeholder values via contains-based detection', () => {
    // Live data: 'typical/default outfit (not specified)'.
    const token = compileAppearanceToken('Becky', {
      hair: 'brown hair',
      attire: 'typical/default outfit (not specified)',
    });
    expect(token).toBe('Becky: brown hair');
  });

  it('drops hedging/meta values entirely', () => {
    // Live data: 'possibly a limp from injuries (implied by multiple mentions)'.
    const token = compileAppearanceToken('Trystan', {
      hair: 'dark hair',
      distinguishing: 'possibly a limp from injuries (implied by multiple mentions)',
    });
    expect(token).toBe('Trystan: dark hair');
  });

  it('drops degenerate bare color adjectives for non-labeled fields, keeps them for labeled ones', () => {
    // Live data: 'Sage: light' (a bare adjective with no noun).
    expect(compileAppearanceToken('Sage', { distinguishing: 'light' })).toBe('Sage');
    expect(compileAppearanceToken('Sage', { age: 'dark' })).toBe('Sage');
    // hair/eyes/skin/build get a label suffix downstream, so they survive.
    expect(compileAppearanceToken('Sage', { hair: 'light' })).toBe('Sage: light');
  });
});

describe('sanitizeTraitValue', () => {
  it('passes ordinary trait values through trimmed', () => {
    expect(sanitizeTraitValue('  lavender hair  ', 'hair')).toBe('lavender hair');
    expect(sanitizeTraitValue('ink-stained fingers', 'distinguishing')).toBe(
      'ink-stained fingers',
    );
  });

  it('nulls empty and exact nullish values', () => {
    expect(sanitizeTraitValue('', 'hair')).toBeNull();
    expect(sanitizeTraitValue('   ', 'hair')).toBeNull();
    expect(sanitizeTraitValue(null, 'hair')).toBeNull();
    expect(sanitizeTraitValue(undefined, 'hair')).toBeNull();
    expect(sanitizeTraitValue('null', 'hair')).toBeNull();
    expect(sanitizeTraitValue('None', 'hair')).toBeNull();
  });

  it('nulls values CONTAINING placeholder patterns (not just exact matches)', () => {
    expect(sanitizeTraitValue('typical/default outfit (not specified)', 'attire')).toBeNull();
    expect(sanitizeTraitValue('Not specified', 'eyes')).toBeNull();
    expect(sanitizeTraitValue('unknown', 'skin')).toBeNull();
    expect(sanitizeTraitValue('color unknown', 'eyes')).toBeNull();
    expect(sanitizeTraitValue('n/a', 'build')).toBeNull();
    expect(sanitizeTraitValue('hair color n/a', 'hair')).toBeNull();
    expect(sanitizeTraitValue('not described in the text', 'attire')).toBeNull();
    expect(sanitizeTraitValue('his default outfit', 'attire')).toBeNull();
  });

  it("does not false-positive 'n/a' inside ordinary words", () => {
    expect(sanitizeTraitValue('tan/auburn complexion', 'skin')).toBe('tan/auburn complexion');
  });

  it('nulls values containing hedging/meta markers', () => {
    expect(
      sanitizeTraitValue('possibly a limp from injuries (implied by multiple mentions)', 'distinguishing'),
    ).toBeNull();
    expect(sanitizeTraitValue('scar (implied)', 'distinguishing')).toBeNull();
    expect(sanitizeTraitValue('mentioned to be tall', 'build')).toBeNull();
    expect(sanitizeTraitValue('text suggests blue', 'eyes')).toBeNull();
    expect(sanitizeTraitValue('may have a beard', 'distinguishing')).toBeNull();
  });

  it('nulls single bare color/light adjectives for non-labeled fields only', () => {
    expect(sanitizeTraitValue('light', 'distinguishing')).toBeNull();
    expect(sanitizeTraitValue('brown', 'attire')).toBeNull();
    expect(sanitizeTraitValue('dark', 'age')).toBeNull();
    // Labeled fields keep them ('light' -> 'light hair' downstream).
    expect(sanitizeTraitValue('light', 'hair')).toBe('light');
    expect(sanitizeTraitValue('brown', 'eyes')).toBe('brown');
    expect(sanitizeTraitValue('dark', 'skin')).toBe('dark');
    expect(sanitizeTraitValue('slim', 'build')).toBe('slim');
    // Multi-word values with a noun are never degenerate.
    expect(sanitizeTraitValue('light blue dress', 'attire')).toBe('light blue dress');
  });
});
