/**
 * Balanced image-density policy: a chapter gets roughly one image per 800
 * words, clamped to a sane [1, 8] range. Pure and unit-testable. This is the N
 * passed to the planner as `maxMoments` (a cap, not a floor).
 */

export const WORDS_PER_IMAGE = 800;
export const MIN_IMAGES_PER_CHAPTER = 1;
export const MAX_IMAGES_PER_CHAPTER = 8;

export function imagesPerChapter(wordCount: number): number {
  const raw = Math.round(wordCount / WORDS_PER_IMAGE);
  return Math.min(MAX_IMAGES_PER_CHAPTER, Math.max(MIN_IMAGES_PER_CHAPTER, raw));
}
