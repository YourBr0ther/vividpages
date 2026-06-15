import { describe, expect, it } from 'vitest';

import { sceneFallbackPoints, type FallbackScene } from '../src/pipeline/imagine';

const scene = (
  startOffset: number,
  keyVisualMoment: string | null,
  summary: string | null,
  presentCharacterIds: string[] = [],
): FallbackScene => ({ startOffset, keyVisualMoment, summary, presentCharacterIds });

describe('sceneFallbackPoints', () => {
  it('returns [] when there are no scenes', () => {
    expect(sceneFallbackPoints([], 7)).toEqual([]);
  });

  it('uses keyVisualMoment when present, else summary', () => {
    const scenes = [
      scene(0, 'a duel at dawn', 'summary A', ['c1']),
      scene(100, null, 'summary B', ['c2']),
    ];
    const points = sceneFallbackPoints(scenes, 7);
    expect(points).toHaveLength(2);
    expect(points[0]!.momentDescription).toBe('a duel at dawn');
    expect(points[1]!.momentDescription).toBe('summary B');
    expect(points[0]!.presentCharacterIds).toEqual(['c1']);
    expect(points[1]!.presentCharacterIds).toEqual(['c2']);
  });

  it('carries scene startOffset as charOffset and a low default score', () => {
    const points = sceneFallbackPoints([scene(42, 'moment', null, [])], 7);
    expect(points[0]!.charOffset).toBe(42);
    expect(points[0]!.score).toBe(1);
  });

  it('uses all scenes when there are fewer than maxMoments', () => {
    const scenes = [scene(0, 'a', null), scene(50, 'b', null), scene(90, 'c', null)];
    const points = sceneFallbackPoints(scenes, 7);
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.momentDescription)).toEqual(['a', 'b', 'c']);
  });

  it('spreads the selection evenly when there are more scenes than maxMoments', () => {
    // 10 scenes, max 3 → endpoints + a middle scene, evenly spread.
    const scenes = Array.from({ length: 10 }, (_, i) =>
      scene(i * 100, `m${i}`, null),
    );
    const points = sceneFallbackPoints(scenes, 3);
    expect(points).toHaveLength(3);
    // First and last scene always kept; middle spread roughly even.
    expect(points[0]!.momentDescription).toBe('m0');
    expect(points[2]!.momentDescription).toBe('m9');
    expect(points[1]!.momentDescription).toBe('m5');
  });

  it('assigns contiguous idx sorted by charOffset', () => {
    const scenes = [scene(200, 'late', null), scene(0, 'early', null), scene(100, 'mid', null)];
    const points = sceneFallbackPoints(scenes, 7);
    expect(points.map((p) => p.idx)).toEqual([0, 1, 2]);
    expect(points.map((p) => p.charOffset)).toEqual([0, 100, 200]);
    expect(points.map((p) => p.momentDescription)).toEqual(['early', 'mid', 'late']);
  });

  it('drops scenes with neither keyVisualMoment nor summary', () => {
    const scenes = [scene(0, null, null), scene(100, 'real', null)];
    const points = sceneFallbackPoints(scenes, 7);
    expect(points).toHaveLength(1);
    expect(points[0]!.momentDescription).toBe('real');
  });

  it('respects maxMoments=1 by keeping a single scene', () => {
    const scenes = [scene(0, 'a', null), scene(100, 'b', null), scene(200, 'c', null)];
    const points = sceneFallbackPoints(scenes, 1);
    expect(points).toHaveLength(1);
  });
});
