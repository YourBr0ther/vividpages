/**
 * Maps an LLM anchor quote back to a character offset in the chapter text so
 * the planned image can be placed inline. Pure and unit-testable.
 *
 * Strategy:
 *   1. exact `indexOf`;
 *   2. else normalize both sides (collapse whitespace runs to a single space,
 *      lowercase) and find the normalized match, mapping the normalized index
 *      back to the original text index;
 *   3. else null.
 *
 * On a hit the offset is snapped back to the START of the paragraph containing
 * the match — the nearest `\n\n` boundary at or before the match (0 if none) —
 * so plates are inserted at paragraph boundaries, never mid-sentence.
 */

/** Snaps an original-text index back to the start of its paragraph. */
function paragraphStart(text: string, matchIndex: number): number {
  const boundary = text.lastIndexOf('\n\n', matchIndex);
  return boundary === -1 ? 0 : boundary + 2;
}

/**
 * Normalizes `text`, returning the normalized string plus a map from each
 * normalized character index to the index of the original character it came
 * from.
 */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let inWhitespaceRun = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      // Collapse a run of whitespace to a single space, mapped to the first
      // whitespace char of the run.
      if (!inWhitespaceRun) {
        chars.push(' ');
        map.push(i);
        inWhitespaceRun = true;
      }
    } else {
      chars.push(ch.toLowerCase());
      map.push(i);
      inWhitespaceRun = false;
    }
  }

  return { normalized: chars.join(''), map };
}

export function locateQuote(text: string, quote: string): number | null {
  // 1. Exact match.
  const exact = text.indexOf(quote);
  if (exact !== -1) {
    return paragraphStart(text, exact);
  }

  // 2. Normalized match (whitespace runs collapsed + lowercased).
  const { normalized, map } = normalizeWithMap(text);
  const normalizedQuote = quote.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalizedQuote.length === 0) return null;

  const normIndex = normalized.indexOf(normalizedQuote);
  const originalIndex = normIndex === -1 ? undefined : map[normIndex];
  if (originalIndex !== undefined) {
    return paragraphStart(text, originalIndex);
  }

  // 3. Not found.
  return null;
}
