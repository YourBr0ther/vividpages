/**
 * Heuristic pre-filter that flags obviously non-story chapters (front/back
 * matter, copyright, promos) so they are never illustrated. Pure (no IO) and
 * fully unit-testable. The LLM planning pass later confirms borderline cases
 * via its `isNarrative` flag; this is the cheap first cut.
 */

/** Chapters shorter than this are treated as non-narrative. */
export const MIN_NARRATIVE_WORDS = 250;

/**
 * Title patterns that mark front/back matter. Case-insensitive; anchored so a
 * narrative chapter merely mentioning one of these words in a longer title is
 * not falsely excluded. `Prologue`, `Epilogue`, and `Chapter N` are
 * deliberately absent — they are narrative.
 */
const NON_NARRATIVE_TITLE_PATTERNS: RegExp[] = [
  /^copyrights?\b/i,
  /^dedication\b/i,
  /^acknowledge?ments?\b/i,
  /^(table of )?contents\b/i,
  /^about the author\b/i,
  /^also by\b/i,
  /^title\s*page\b/i,
  /^foreword\b/i,
  /^epigraph\b/i,
  /^index\b/i,
  /^glossary\b/i,
  /^praise for\b/i,
  // A "by <Author>" credit line: either the whole title starts with "by " or
  // it is a "<Title>, by <Author>" promo line (e.g. idx 62 "Star Bringer, by
  // Tracy Wolff and Nina Croft").
  /^by\s+\S/i,
  /,\s*by\s+\S/i,
];

export function isNonNarrative(chapter: {
  title: string | null;
  wordCount: number;
}): boolean {
  if (chapter.wordCount < MIN_NARRATIVE_WORDS) return true;

  const title = chapter.title?.trim();
  if (!title) return false;

  return NON_NARRATIVE_TITLE_PATTERNS.some((re) => re.test(title));
}
