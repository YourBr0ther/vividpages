import { describe, expect, it, vi } from 'vitest';

import {
  buildOutfitPrompt,
  cleanClothingSignals,
  consolidateWardrobe,
  type ClothingSignal,
} from '../src/characters/wardrobe-extract';
import type { RawOutfit } from '../src/characters/wardrobe';

describe('cleanClothingSignals', () => {
  it('strips transient signals and keeps clothing', () => {
    const signals: ClothingSignal[] = [
      { text: 'a bleeding gash on her arm' },
      { text: 'a long green velvet cloak' },
      { text: 'blood-soaked white shirt' },
    ];
    expect(cleanClothingSignals(signals)).toEqual([
      'a long green velvet cloak',
      'white shirt',
    ]);
  });

  it('dedupes identical cleaned strings case-insensitively', () => {
    const signals: ClothingSignal[] = [
      { text: 'navy uniform' },
      { text: 'Navy Uniform' },
      { text: 'soaked' },
    ];
    expect(cleanClothingSignals(signals)).toEqual(['navy uniform']);
  });

  it('returns empty when every signal is transient', () => {
    const signals: ClothingSignal[] = [{ text: 'furious' }, { text: 'soaked to the bone' }];
    expect(cleanClothingSignals(signals)).toEqual([]);
  });
});

describe('buildOutfitPrompt', () => {
  it('lists cleaned signals and forbids body traits', () => {
    const { prompt } = buildOutfitPrompt('Evie', ['navy uniform', 'red gown']);
    expect(prompt).toContain('navy uniform');
    expect(prompt).toContain('red gown');
    expect(prompt).toContain('EXCLUDE body traits');
  });
});

describe('consolidateWardrobe', () => {
  it('cleans -> extracts -> dedupes -> single-base clamps', async () => {
    const extractor = vi.fn(async (_name: string, _signals: string[]) => ({
      outfits: [
        { descriptor: 'navy uniform', sceneMentions: 5 },
        { descriptor: 'a long green cloak', sceneMentions: 2 },
        { descriptor: 'long green cloak', sceneMentions: 1 }, // near-dupe -> merges
      ] satisfies RawOutfit[],
      tokensIn: 10,
      tokensOut: 20,
    }));

    const { states, tokensIn, tokensOut } = await consolidateWardrobe(
      'Evie',
      [{ text: 'navy uniform' }, { text: 'a long green cloak' }],
      extractor,
    );

    expect(extractor).toHaveBeenCalledOnce();
    // The cloak dupes merged -> 2 distinct outfits.
    expect(states).toHaveLength(2);
    // Exactly one base, the max-mentions outfit.
    const bases = states.filter((s) => s.isBase);
    expect(bases).toHaveLength(1);
    expect(bases[0]!.descriptor).toBe('navy uniform');
    expect(tokensIn).toBe(10);
    expect(tokensOut).toBe(20);
  });

  it('does not call the extractor when no clothing signal survives', async () => {
    const extractor = vi.fn();
    const { states } = await consolidateWardrobe(
      'Ghost',
      [{ text: 'furious' }, { text: 'bleeding gash' }],
      extractor,
    );
    expect(states).toEqual([]);
    expect(extractor).not.toHaveBeenCalled();
  });

  it('produces exactly one base when the extractor returns several outfits', async () => {
    const extractor = vi.fn(async () => ({
      outfits: [
        { descriptor: 'navy uniform', sceneMentions: 1 },
        { descriptor: 'red ballgown', sceneMentions: 1 },
        { descriptor: 'leather riding gear', sceneMentions: 1 },
      ] satisfies RawOutfit[],
      tokensIn: 0,
      tokensOut: 0,
    }));
    const { states } = await consolidateWardrobe('X', [{ text: 'navy uniform' }], extractor);
    expect(states.filter((s) => s.isBase)).toHaveLength(1);
  });
});
