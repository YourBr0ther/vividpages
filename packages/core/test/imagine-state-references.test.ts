import { describe, expect, it } from 'vitest';

import { planStateReferenceItems, type StateRefCharacter } from '../src/pipeline/imagine';

const charA: StateRefCharacter = {
  id: 'char-a',
  name: 'Evie',
  role: 'main',
  wardrobeUpgraded: false,
  appearanceToken: 'Evie: a young woman',
  profile: null,
  bodyModel: 'a young woman, slender build, lavender hair',
  loraKeyword: null,
  loraName: null,
  loraStrength: null,
  states: [
    { id: 'state-a-base', type: 'base', descriptor: 'a practical work dress', imageObjectKey: null },
    { id: 'state-a-add1', type: 'additional', descriptor: 'a velvet gown', imageObjectKey: null },
  ],
};

const minorUpgraded: StateRefCharacter = {
  id: 'char-b',
  name: 'Bram',
  role: 'minor',
  wardrobeUpgraded: true,
  appearanceToken: 'Bram: an old man',
  profile: null,
  bodyModel: 'an old man, stooped, grey beard',
  loraKeyword: null,
  loraName: null,
  loraStrength: null,
  states: [
    { id: 'state-b-base', type: 'base', descriptor: 'a leather apron', imageObjectKey: null },
  ],
};

const minorPlain: StateRefCharacter = {
  id: 'char-c',
  name: 'Guard',
  role: 'minor',
  wardrobeUpgraded: false,
  appearanceToken: 'Guard: a soldier',
  profile: null,
  bodyModel: 'a soldier, broad shoulders',
  loraKeyword: null,
  loraName: null,
  loraStrength: null,
  states: [
    { id: 'state-c-base', type: 'base', descriptor: 'chainmail', imageObjectKey: null },
  ],
};

describe('planStateReferenceItems', () => {
  it('emits one item per state for an eligible main character (base + additional)', () => {
    const items = planStateReferenceItems([charA], () => 0);
    expect(items.map((i) => i.stateId)).toEqual(['state-a-base', 'state-a-add1']);
    expect(items.map((i) => i.outfit)).toEqual(['a practical work dress', 'a velvet gown']);
    expect(items.every((i) => i.bodyModel === 'a young woman, slender build, lavender hair')).toBe(
      true,
    );
    expect(items.every((i) => i.characterId === 'char-a')).toBe(true);
  });

  it('includes upgraded minors and EXCLUDES non-upgraded minors', () => {
    const items = planStateReferenceItems([charA, minorUpgraded, minorPlain], () => 0);
    const charIds = new Set(items.map((i) => i.characterId));
    expect(charIds.has('char-a')).toBe(true);
    expect(charIds.has('char-b')).toBe(true);
    expect(charIds.has('char-c')).toBe(false);
  });

  it('only emits base + additional state types (no underwear/nude in Phase 2)', () => {
    const withMature: StateRefCharacter = {
      ...charA,
      states: [
        ...charA.states,
        { id: 'state-a-nude', type: 'nude', descriptor: 'bare', imageObjectKey: null },
        { id: 'state-a-under', type: 'underwear', descriptor: 'undergarments', imageObjectKey: null },
      ],
    };
    const items = planStateReferenceItems([withMature], () => 0);
    expect(items.map((i) => i.stateId)).toEqual(['state-a-base', 'state-a-add1']);
  });

  it('resume-skips states that already have an imageObjectKey', () => {
    const partlyDone: StateRefCharacter = {
      ...charA,
      states: [
        { ...charA.states[0]!, imageObjectKey: 'images/book/appearance_state/state-a-base/v1.webp' },
        charA.states[1]!,
      ],
    };
    const items = planStateReferenceItems([partlyDone], () => 0);
    expect(items.map((i) => i.stateId)).toEqual(['state-a-add1']);
  });

  it('computes the next version per state via maxVersionFor', () => {
    const items = planStateReferenceItems([charA], (stateId) =>
      stateId === 'state-a-base' ? 2 : 0,
    );
    const byId = new Map(items.map((i) => [i.stateId, i.version]));
    expect(byId.get('state-a-base')).toBe(3);
    expect(byId.get('state-a-add1')).toBe(1);
  });

  it('skips characters with no eligible states and returns empty for empty input', () => {
    expect(planStateReferenceItems([], () => 0)).toEqual([]);
    const noStates: StateRefCharacter = { ...charA, states: [] };
    expect(planStateReferenceItems([noStates], () => 0)).toEqual([]);
  });
});
