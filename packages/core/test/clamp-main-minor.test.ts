import { describe, expect, it } from 'vitest';

import { clampMainMinor, MAIN_SCENE_RATIO } from '../src/pipeline/profiles';

describe('clampMainMinor', () => {
  // The deterministic scene-share floor: a character in >= MAIN_SCENE_RATIO of
  // the book's scenes is 'main' regardless of the LLM's (noisy) call. Below the
  // floor the LLM's judgment stands.

  it('raises a mislabeled minor to main at or above the scene-share floor', () => {
    // 12 of 100 scenes == exactly MAIN_SCENE_RATIO (0.12) — forced to 'main'.
    expect(clampMainMinor('minor', 12, 100)).toBe('main');
    // Well above the floor.
    expect(clampMainMinor('minor', 85, 101)).toBe('main');
  });

  it('keeps main when the LLM said main and the share is above the floor', () => {
    expect(clampMainMinor('main', 50, 100)).toBe('main');
  });

  it('keeps the LLM call below the floor (both main and minor)', () => {
    // < 12%: the floor does not fire, so the model's judgment is preserved.
    expect(clampMainMinor('minor', 5, 100)).toBe('minor');
    expect(clampMainMinor('main', 5, 100)).toBe('main');
  });

  it('returns the role unchanged when totalScenes is 0 (no share to compute)', () => {
    expect(clampMainMinor('minor', 0, 0)).toBe('minor');
    expect(clampMainMinor('main', 3, 0)).toBe('main');
  });

  it('uses MAIN_SCENE_RATIO = 0.12 as the floor', () => {
    expect(MAIN_SCENE_RATIO).toBe(0.12);
    // Just below the floor stays minor; the boundary (==) is inclusive.
    expect(clampMainMinor('minor', 11, 100)).toBe('minor');
    expect(clampMainMinor('minor', 12, 100)).toBe('main');
  });
});
