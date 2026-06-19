import { describe, expect, it, vi } from 'vitest';

import {
  assignPointStates,
  buildAssignmentPrompt,
  buildAssignmentSchema,
  type AssignSceneContext,
} from '../src/characters/wardrobe-assign';
import type { CharacterStates } from '../src/characters/state-assign';

const SCENE: AssignSceneContext = { setting: 'a ballroom', timeOfDay: 'night', mood: 'tense' };

const evie: CharacterStates = {
  characterId: 'c-evie',
  name: 'Evie',
  states: [
    { id: 's-base', type: 'base', descriptor: 'navy uniform', isBase: true },
    { id: 's-gown', type: 'additional', descriptor: 'red ballgown', isBase: false },
  ],
};
const solo: CharacterStates = {
  characterId: 'c-solo',
  name: 'Solo',
  states: [{ id: 's-solo-base', type: 'base', descriptor: 'leather coat', isBase: true }],
};
const ghost: CharacterStates = { characterId: 'c-ghost', name: 'Ghost', states: [] };

describe('buildAssignmentSchema', () => {
  it('constrains each character to its own state ids and rejects cross picks', () => {
    const schema = buildAssignmentSchema([evie]);
    expect(schema.safeParse({ assignments: { 'c-evie': 's-gown' } }).success).toBe(true);
    expect(schema.safeParse({ assignments: { 'c-evie': 's-solo-base' } }).success).toBe(false);
  });

  it('omits single-state characters from the schema (no pick required)', () => {
    const schema = buildAssignmentSchema([solo]);
    // Empty assignments object validates (solo is not a required key).
    expect(schema.safeParse({ assignments: {} }).success).toBe(true);
  });
});

describe('buildAssignmentPrompt', () => {
  it('lists each enumerated state with id + descriptor and instructs default-base', () => {
    const { system, prompt } = buildAssignmentPrompt('Evie waltzes in a gown.', SCENE, [evie]);
    expect(prompt).toContain('s-base');
    expect(prompt).toContain('navy uniform');
    expect(prompt).toContain('red ballgown');
    expect(prompt).toContain('BASE');
    expect(prompt).toContain('a ballroom');
    expect(system).toContain('Default to the BASE state');
  });
});

describe('assignPointStates', () => {
  it('calls the picker once for multi-state characters and merges in-enum picks', async () => {
    const picker = vi.fn(async () => ({ 'c-evie': 's-gown' }));
    const result = await assignPointStates(
      'Evie waltzes in a gown beside Solo.',
      SCENE,
      [evie, solo, ghost],
      picker,
    );
    expect(picker).toHaveBeenCalledOnce();
    // multi-state Evie uses the pick; single-state Solo forced to base; Ghost omitted.
    expect(result).toEqual({ 'c-evie': 's-gown', 'c-solo': 's-solo-base' });
  });

  it('makes NO picker call when no present character has multiple states', async () => {
    const picker = vi.fn();
    const result = await assignPointStates('Solo walks alone.', SCENE, [solo, ghost], picker);
    expect(picker).not.toHaveBeenCalled();
    expect(result).toEqual({ 'c-solo': 's-solo-base' });
  });

  it('defaults to base when the picker omits or mis-picks a character (backstop)', async () => {
    const picker = vi.fn(async () => ({ 'c-evie': 'bogus-id' }));
    const result = await assignPointStates('A quiet scene.', SCENE, [evie], picker);
    expect(result).toEqual({ 'c-evie': 's-base' });
  });

  it('returns an empty map when only no-state characters are present', async () => {
    const picker = vi.fn();
    const result = await assignPointStates('Ghost drifts by.', SCENE, [ghost], picker);
    expect(picker).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
