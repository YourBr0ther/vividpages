import { z } from 'zod';

/**
 * Zod contract for the per-chapter illustration-planning LLM call. Validated
 * with the same repair-retry path as scene analysis. `isNarrative:false`
 * implies an empty `moments` array (front/back matter, promos, etc.).
 */

/** Max planned moments per chapter (matches the upper count clamp). */
export const MAX_PLAN_MOMENTS = 8;

export const illustrationMomentSchema = z.object({
  /** Verbatim chapter sentence the moment keys on; locates the offset. */
  anchorQuote: z.string().min(1),
  /** One filmable sentence describing the visual moment. */
  description: z.string().min(1),
  /** Roster-resolved names of characters present in the moment. */
  characters: z.array(z.string()),
  /** Importance rank, 1 (minor) to 5 (key beat). */
  importance: z.number().int().min(1).max(5),
});

export const chapterPlanSchema = z.object({
  /** False for front/back matter, copyright, promos, non-story prose. */
  isNarrative: z.boolean(),
  moments: z.array(illustrationMomentSchema).max(MAX_PLAN_MOMENTS),
});

export type IllustrationMoment = z.infer<typeof illustrationMomentSchema>;
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;
