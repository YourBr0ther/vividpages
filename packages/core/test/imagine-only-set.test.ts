import { describe, expect, it } from 'vitest';

import { planOnlyStoryboardSet } from '../src/pipeline/imagine';

interface P {
  id: string;
  chapterId: string;
  idx: number;
}

const points: P[] = [
  { id: 'p1', chapterId: 'c1', idx: 0 },
  { id: 'p2', chapterId: 'c1', idx: 1 },
  { id: 'p3', chapterId: 'c2', idx: 0 },
];

describe('planOnlyStoryboardSet', () => {
  it('selects the requested points with version = max+1 each', () => {
    const maxVersionFor = (id: string) => ({ p1: 2, p2: 0, p3: 5 })[id] ?? 0;
    const plan = planOnlyStoryboardSet(points, ['p1', 'p3'], maxVersionFor);
    expect(plan).toEqual([
      { point: points[0], version: 3 },
      { point: points[2], version: 6 },
    ]);
  });

  it('defaults version to 1 when a point has no prior image', () => {
    const plan = planOnlyStoryboardSet(points, ['p2'], () => 0);
    expect(plan).toEqual([{ point: points[1], version: 1 }]);
  });

  it('preserves the order of subjectIds, not point order', () => {
    const plan = planOnlyStoryboardSet(points, ['p3', 'p1'], () => 0);
    expect(plan.map((w) => w.point.id)).toEqual(['p3', 'p1']);
  });

  it('dedupes repeated subjectIds (one work item per point)', () => {
    const plan = planOnlyStoryboardSet(points, ['p1', 'p1'], () => 0);
    expect(plan.map((w) => w.point.id)).toEqual(['p1']);
  });

  it('throws on an unknown subjectId (stale regenerate request)', () => {
    expect(() => planOnlyStoryboardSet(points, ['p1', 'ghost'], () => 0)).toThrow(/ghost/);
  });

  it('returns an empty plan for an empty set', () => {
    expect(planOnlyStoryboardSet(points, [], () => 0)).toEqual([]);
  });
});
