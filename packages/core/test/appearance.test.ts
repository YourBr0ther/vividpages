import { describe, expect, it } from 'vitest';

import {
  compileAppearanceToken,
  MAX_APPEARANCE_WORDS,
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
});
