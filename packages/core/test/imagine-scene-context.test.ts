import { describe, expect, it } from 'vitest';

import { sceneContextForOffset } from '../src/pipeline/imagine';

const scene = (
  startOffset: number,
  endOffset: number,
  setting: string | null,
  timeOfDay: string | null = null,
  mood: string | null = null,
  sceneType: string | null = null,
) => ({ startOffset, endOffset, setting, timeOfDay, mood, sceneType });

describe('sceneContextForOffset', () => {
  it('returns the empty context when no scenes exist', () => {
    expect(sceneContextForOffset([], 42)).toEqual({
      setting: null,
      timeOfDay: null,
      mood: null,
      sceneType: null,
    });
  });

  it('borrows setting/mood/timeOfDay/sceneType from the scene containing the offset', () => {
    const scenes = [
      scene(0, 100, 'tavern', 'evening', 'tense', 'dialogue'),
      scene(100, 200, 'forest', 'dawn', 'eerie', 'action'),
    ];
    expect(sceneContextForOffset(scenes, 150)).toEqual({
      setting: 'forest',
      timeOfDay: 'dawn',
      mood: 'eerie',
      sceneType: 'action',
    });
  });

  it('treats endOffset as exclusive and startOffset as inclusive', () => {
    const scenes = [scene(0, 100, 'tavern'), scene(100, 200, 'forest')];
    // offset 100 belongs to the second scene (inclusive start).
    expect(sceneContextForOffset(scenes, 100).setting).toBe('forest');
    // offset 99 belongs to the first scene.
    expect(sceneContextForOffset(scenes, 99).setting).toBe('tavern');
  });

  it('falls back to the chapter first scene (lowest startOffset) for an offset in no span', () => {
    const scenes = [scene(50, 100, 'forest'), scene(10, 50, 'tavern')];
    // Offset 200 is past every span → first scene by startOffset (the tavern).
    expect(sceneContextForOffset(scenes, 200).setting).toBe('tavern');
    // Offset 5 precedes every span → still the first scene.
    expect(sceneContextForOffset(scenes, 5).setting).toBe('tavern');
  });

  it('prefers the containing scene over the first scene', () => {
    const scenes = [scene(0, 50, 'tavern'), scene(50, 100, 'forest')];
    expect(sceneContextForOffset(scenes, 70).setting).toBe('forest');
  });
});
