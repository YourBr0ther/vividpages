import { describe, expect, it } from 'vitest';

import {
  orderAppearanceStates,
  showsUpgradeControl,
  stateTypeLabel,
  type DisplayState,
} from '../src/characters/wardrobe-display';

const state = (over: Partial<DisplayState> & Pick<DisplayState, 'id' | 'type'>): DisplayState => ({
  descriptor: 'a plain tunic',
  isBase: over.type === 'base',
  imageObjectKey: null,
  thumbObjectKey: null,
  ...over,
});

describe('orderAppearanceStates', () => {
  it('puts the base outfit first, then additional (ties by descriptor)', () => {
    const ordered = orderAppearanceStates([
      state({ id: 'b', type: 'additional', descriptor: 'a red gown' }),
      state({ id: 'a', type: 'base', descriptor: 'a blue dress' }),
      state({ id: 'c', type: 'additional', descriptor: 'a green cloak' }),
    ]);
    // base first; the two additional outfits then sort lexicographically:
    // "a green cloak" (c) before "a red gown" (b).
    expect(ordered.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('orders future mature types after additional (underwear then nude)', () => {
    // Phase 2 never produces these, but the display must be ready for them.
    const ordered = orderAppearanceStates([
      state({ id: 'nude', type: 'nude' }),
      state({ id: 'add', type: 'additional' }),
      state({ id: 'under', type: 'underwear' }),
      state({ id: 'base', type: 'base' }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(['base', 'add', 'under', 'nude']);
  });

  it('breaks ties within a type stably by descriptor', () => {
    const ordered = orderAppearanceStates([
      state({ id: 'z', type: 'additional', descriptor: 'z-coat' }),
      state({ id: 'a', type: 'additional', descriptor: 'a-coat' }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'z']);
  });

  it('keeps unknown types last without throwing', () => {
    const ordered = orderAppearanceStates([
      state({ id: 'weird', type: 'something-new' }),
      state({ id: 'base', type: 'base' }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(['base', 'weird']);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = [state({ id: 'a', type: 'additional' }), state({ id: 'b', type: 'base' })];
    const snapshot = input.map((s) => s.id);
    orderAppearanceStates(input);
    expect(input.map((s) => s.id)).toEqual(snapshot);
  });
});

describe('stateTypeLabel', () => {
  it('maps known types to human labels', () => {
    expect(stateTypeLabel('base')).toBe('Base');
    expect(stateTypeLabel('additional')).toBe('Additional');
    expect(stateTypeLabel('underwear')).toBe('Underwear');
    expect(stateTypeLabel('nude')).toBe('Nude');
  });

  it('falls back to a capitalized form for unknown types', () => {
    expect(stateTypeLabel('something-new')).toBe('Something-new');
    expect(stateTypeLabel('')).toBe('');
  });
});

describe('showsUpgradeControl', () => {
  it('shows for a minor with no states and not yet upgraded', () => {
    expect(showsUpgradeControl({ role: 'minor', wardrobeUpgraded: false, stateCount: 0 })).toBe(
      true,
    );
  });

  it('shows for an upgraded minor pending its next run (so they see the status)', () => {
    expect(showsUpgradeControl({ role: 'minor', wardrobeUpgraded: true, stateCount: 0 })).toBe(
      true,
    );
  });

  it('does not show for a main character', () => {
    expect(showsUpgradeControl({ role: 'main', wardrobeUpgraded: false, stateCount: 0 })).toBe(
      false,
    );
    expect(showsUpgradeControl({ role: 'main', wardrobeUpgraded: false, stateCount: 3 })).toBe(
      false,
    );
  });

  it('does not show for a minor that already has wardrobe states', () => {
    expect(showsUpgradeControl({ role: 'minor', wardrobeUpgraded: true, stateCount: 2 })).toBe(
      false,
    );
  });
});
