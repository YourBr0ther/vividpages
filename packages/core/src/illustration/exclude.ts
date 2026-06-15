/**
 * Heuristic pre-filter that flags obviously non-story chapters (front/back
 * matter, copyright, promos) so they are never illustrated. Pure (no IO) and
 * fully unit-testable. The LLM planning pass later confirms borderline cases
 * via its `isNarrative` flag; this is the cheap first cut.
 */

/** Chapters shorter than this are treated as non-narrative. */
export const MIN_NARRATIVE_WORDS = 250;

/**
 * Front/back-matter title patterns, case-insensitive. Two flavours:
 *
 * - FULL-title patterns must match the ENTIRE title (modulo trailing
 *   punctuation/whitespace, applied below). Short front-matter labels live
 *   here so "Dedication" is excluded but a hypothetical story chapter
 *   "Dedication of the Knights" is not.
 * - PREFIX patterns match the start of the title; reserved for phrases that are
 *   always front/back matter regardless of what follows ("Also by …",
 *   "Praise for …", and the comma-form byline "<Title>, by <Author>").
 *
 * `Prologue`, `Epilogue`, and `Chapter N` are deliberately absent — they are
 * narrative.
 */
const FULL_TITLE_PATTERNS: RegExp[] = [
  /copyrights?/,
  /dedication/,
  /acknowledge?ments?/,
  /contents/,
  /table of contents/,
  /about the author/,
  /title\s*page/,
  /foreword/,
  /epigraph/,
  /index/,
  /glossary/,
];

/**
 * A full title that is a "by <Author>" credit line, e.g. "by Tracy Wolff" or
 * "By J. R. R. Tolkien". The author part must read as a proper name —
 * capitalized words (and the connector "and") only — so prose titles that
 * merely open with "By" and then a lowercase function word ("By the Sea",
 * "By Nightfall" → "Nightfall" is capitalized but stands alone) need care.
 *
 * "By the Sea" / "By Nightfall" must NOT match: the former contains the
 * lowercase article "the"; the latter is a single capitalized word, which a
 * one-word byline could also be — so we additionally require a byline to have
 * at least TWO name tokens (first + last), which a one-word title lacks. Real
 * single-token credit lines ("by Anonymous") are rare and acceptable misses.
 *
 * No `i` flag: the capitalization of the name tokens is load-bearing.
 */
const FULL_BYLINE_RE = /^[Bb]y\s+[A-Z][\w.'-]*(?:\s+(?:and\s+)?[A-Z][\w.'-]*)+$/;

const PREFIX_PATTERNS: RegExp[] = [
  /^also by\b/i,
  /^praise for\b/i,
  // "<Title>, by <Author>" promo line (e.g. idx 62 "Star Bringer, by Tracy
  // Wolff and Nina Croft"). The comma distinguishes it from a story title that
  // simply begins with "By".
  /,\s*by\s+\S/i,
];

export function isNonNarrative(chapter: {
  title: string | null;
  wordCount: number;
}): boolean {
  if (chapter.wordCount < MIN_NARRATIVE_WORDS) return true;

  const title = chapter.title?.trim();
  if (!title) return false;

  // Compare full-title patterns against the title stripped of trailing
  // punctuation/whitespace so "Dedication." or "Contents " still match.
  const stripped = title.replace(/[\s.:;,!?-]+$/u, '');
  if (FULL_TITLE_PATTERNS.some((re) => new RegExp(`^${re.source}$`, 'i').test(stripped))) {
    return true;
  }
  if (FULL_BYLINE_RE.test(stripped)) return true;

  return PREFIX_PATTERNS.some((re) => re.test(title));
}
