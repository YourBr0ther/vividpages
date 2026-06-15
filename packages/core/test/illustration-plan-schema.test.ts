import { describe, expect, it } from 'vitest';

import { chapterPlanSchema } from '../src/illustration/plan-schema';

const validMoment = {
  anchorQuote: 'She drew her sword and charged.',
  description: 'A warrior charges across a smoky battlefield, sword raised.',
  characters: ['Evie'],
  importance: 4,
};

describe('chapterPlanSchema', () => {
  it('accepts a well-formed narrative plan', () => {
    const parsed = chapterPlanSchema.parse({
      isNarrative: true,
      moments: [validMoment],
    });
    expect(parsed.isNarrative).toBe(true);
    expect(parsed.moments).toHaveLength(1);
  });

  it('accepts a non-narrative plan with no moments', () => {
    const parsed = chapterPlanSchema.parse({ isNarrative: false, moments: [] });
    expect(parsed.moments).toHaveLength(0);
  });

  it('rejects importance below 1', () => {
    expect(() =>
      chapterPlanSchema.parse({
        isNarrative: true,
        moments: [{ ...validMoment, importance: 0 }],
      }),
    ).toThrow();
  });

  it('rejects importance above 5', () => {
    expect(() =>
      chapterPlanSchema.parse({
        isNarrative: true,
        moments: [{ ...validMoment, importance: 6 }],
      }),
    ).toThrow();
  });

  it('rejects non-integer importance', () => {
    expect(() =>
      chapterPlanSchema.parse({
        isNarrative: true,
        moments: [{ ...validMoment, importance: 3.5 }],
      }),
    ).toThrow();
  });

  it('rejects an empty anchorQuote', () => {
    expect(() =>
      chapterPlanSchema.parse({
        isNarrative: true,
        moments: [{ ...validMoment, anchorQuote: '' }],
      }),
    ).toThrow();
  });

  it('rejects an empty description', () => {
    expect(() =>
      chapterPlanSchema.parse({
        isNarrative: true,
        moments: [{ ...validMoment, description: '' }],
      }),
    ).toThrow();
  });

  it('rejects more than 8 moments', () => {
    expect(() =>
      chapterPlanSchema.parse({
        isNarrative: true,
        moments: Array.from({ length: 9 }, () => validMoment),
      }),
    ).toThrow();
  });

  it('accepts exactly 8 moments', () => {
    const parsed = chapterPlanSchema.parse({
      isNarrative: true,
      moments: Array.from({ length: 8 }, () => validMoment),
    });
    expect(parsed.moments).toHaveLength(8);
  });
});
