import { describe, expect, it } from 'vitest';

import { mergedAliases, remapPresentIds } from '../src/characters/merge';

describe('mergedAliases', () => {
  it('unions keep aliases, the absorbed name, and absorbed aliases', () => {
    expect(
      mergedAliases(
        { name: 'The Villain', aliases: ['The Shadow'] },
        { name: 'Trystan', aliases: ['Trys'] },
      ),
    ).toEqual(['The Shadow', 'Trystan', 'Trys']);
  });

  it("never includes the keeper's own name", () => {
    expect(
      mergedAliases(
        { name: 'Evie', aliases: [] },
        { name: 'Evelyn', aliases: ['Evie'] },
      ),
    ).toEqual(['Evelyn']);
  });

  it('dedupes by match key (case/whitespace/diacritics-insensitive)', () => {
    expect(
      mergedAliases(
        { name: 'Renée', aliases: ['Ren'] },
        { name: 'renee', aliases: ['REN', 'Ren '] },
      ),
    ).toEqual(['Ren']);
  });

  it('display-normalizes aliases (trim + collapse whitespace)', () => {
    expect(
      mergedAliases(
        { name: 'A', aliases: ['  The   Boss '] },
        { name: 'B', aliases: [] },
      ),
    ).toEqual(['The Boss', 'B']);
  });

  it('drops empty/blank candidates', () => {
    expect(
      mergedAliases(
        { name: 'A', aliases: ['', '   '] },
        { name: 'B', aliases: [''] },
      ),
    ).toEqual(['B']);
  });

  it('returns an empty list when the absorbed identity duplicates the keeper', () => {
    expect(
      mergedAliases(
        { name: 'Sam', aliases: [] },
        { name: 'Sam', aliases: ['Sam'] },
      ),
    ).toEqual([]);
  });
});

describe('remapPresentIds', () => {
  const KEEP = 'keep-id';
  const ABSORB = 'absorb-id';

  it('replaces the absorbed id with the keep id', () => {
    expect(remapPresentIds(['x', ABSORB, 'y'], ABSORB, KEEP)).toEqual(['x', KEEP, 'y']);
  });

  it('is a no-op when the absorbed id is absent', () => {
    expect(remapPresentIds(['x', 'y'], ABSORB, KEEP)).toEqual(['x', 'y']);
  });

  it('collapses to a single keep id when both ids are already present', () => {
    expect(remapPresentIds([KEEP, ABSORB], ABSORB, KEEP)).toEqual([KEEP]);
    expect(remapPresentIds([ABSORB, KEEP], ABSORB, KEEP)).toEqual([KEEP]);
  });

  it('dedupes repeated absorbed occurrences into one keep id', () => {
    expect(remapPresentIds([ABSORB, 'x', ABSORB], ABSORB, KEEP)).toEqual([KEEP, 'x']);
  });

  it('preserves first-seen order and pre-existing duplicates collapse', () => {
    expect(remapPresentIds(['a', 'a', ABSORB, 'b'], ABSORB, KEEP)).toEqual(['a', KEEP, 'b']);
  });

  it('returns an empty array for empty input', () => {
    expect(remapPresentIds([], ABSORB, KEEP)).toEqual([]);
  });
});
