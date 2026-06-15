import { describe, expect, it } from 'vitest';

import { imagesPerChapter } from '../src/illustration/count';

describe('imagesPerChapter', () => {
  it('rounds words/800 (1577 -> 2)', () => {
    expect(imagesPerChapter(1577)).toBe(2);
  });

  it('rounds words/800 (5796 -> 7)', () => {
    expect(imagesPerChapter(5796)).toBe(7);
  });

  it('caps at 8 (12000 -> 8)', () => {
    expect(imagesPerChapter(12000)).toBe(8);
  });

  it('floors at 1 (400 -> 1)', () => {
    expect(imagesPerChapter(400)).toBe(1);
  });

  it('floors at 1 (100 -> 1)', () => {
    expect(imagesPerChapter(100)).toBe(1);
  });
});
