import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buildStateEnum,
  mergeStateAssignments,
  partitionForAssignment,
  type CharacterStateOption,
  type CharacterStates,
} from '../src/characters/state-assign';

const base: CharacterStateOption = {
  id: 's-base',
  type: 'base',
  descriptor: 'navy uniform',
  isBase: true,
};
const gown: CharacterStateOption = {
  id: 's-gown',
  type: 'additional',
  descriptor: 'red ballgown',
  isBase: false,
};
const cloak: CharacterStateOption = {
  id: 's-cloak',
  type: 'additional',
  descriptor: 'green travel cloak',
  isBase: false,
};

describe('buildStateEnum', () => {
  it('returns null when the character has no states', () => {
    expect(buildStateEnum([])).toBeNull();
  });

  it('builds a hard enum over the state ids and resolves the base default', () => {
    const built = buildStateEnum([base, gown, cloak]);
    expect(built).not.toBeNull();
    expect(built!.enumIds).toEqual(['s-base', 's-gown', 's-cloak']);
    expect(built!.defaultBaseId).toBe('s-base');
    expect(built!.single).toBe(false);
    // The enum rejects an out-of-list id and accepts in-list ones.
    expect(built!.schema.safeParse('s-gown').success).toBe(true);
    expect(built!.schema.safeParse('not-a-state').success).toBe(false);
  });

  it('flags single state and forces it as the default base', () => {
    const built = buildStateEnum([base]);
    expect(built!.single).toBe(true);
    expect(built!.defaultBaseId).toBe('s-base');
  });

  it('falls back to the first state when no state is flagged isBase', () => {
    const noBase = [
      { ...gown, isBase: false },
      { ...cloak, isBase: false },
    ];
    const built = buildStateEnum(noBase);
    expect(built!.defaultBaseId).toBe('s-gown');
  });
});

describe('mergeStateAssignments', () => {
  const chars: CharacterStates[] = [
    { characterId: 'c-evie', name: 'Evie', states: [base, gown, cloak] },
    { characterId: 'c-solo', name: 'Solo', states: [{ ...base, id: 's-solo-base' }] },
    { characterId: 'c-ghost', name: 'Ghost', states: [] },
  ];

  it('keeps a valid in-enum pick, forces single-state to base, omits no-state', () => {
    const result = mergeStateAssignments(chars, { 'c-evie': 's-gown' });
    expect(result).toEqual({ 'c-evie': 's-gown', 'c-solo': 's-solo-base' });
    expect(result['c-ghost']).toBeUndefined();
  });

  it('defaults to base when the pick is missing', () => {
    const result = mergeStateAssignments(chars, {});
    expect(result['c-evie']).toBe('s-base');
  });

  it('defaults to base when the pick is not one of the character ids', () => {
    // The hard enum makes this structurally impossible, but the merger is the
    // backstop the spike demands.
    const result = mergeStateAssignments(chars, { 'c-evie': 's-someone-elses-id' });
    expect(result['c-evie']).toBe('s-base');
  });
});

describe('partitionForAssignment', () => {
  it('splits multi-state (LLM) from single-state (forced base), dropping no-state', () => {
    const chars: CharacterStates[] = [
      { characterId: 'c-evie', name: 'Evie', states: [base, gown] },
      { characterId: 'c-solo', name: 'Solo', states: [{ ...base, id: 's-solo-base' }] },
      { characterId: 'c-ghost', name: 'Ghost', states: [] },
    ];
    const { needLlm, forcedBase } = partitionForAssignment(chars);
    expect(needLlm.map((c) => c.characterId)).toEqual(['c-evie']);
    expect(forcedBase).toEqual({ 'c-solo': 's-solo-base' });
  });

  it('needs no LLM when every present character has at most one state', () => {
    const chars: CharacterStates[] = [
      { characterId: 'c-solo', name: 'Solo', states: [base] },
      { characterId: 'c-ghost', name: 'Ghost', states: [] },
    ];
    const { needLlm, forcedBase } = partitionForAssignment(chars);
    expect(needLlm).toEqual([]);
    expect(forcedBase).toEqual({ 'c-solo': 's-base' });
  });
});

// Guards the z import is the right one (enum construction sanity).
describe('z import', () => {
  it('is the project zod', () => {
    expect(typeof z.enum).toBe('function');
  });
});
