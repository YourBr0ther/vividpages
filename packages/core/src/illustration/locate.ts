/**
 * Maps an LLM anchor quote back to a character offset in the chapter text so
 * the planned image can be placed inline. Pure and unit-testable.
 *
 * Strategy:
 *   1. exact `indexOf`;
 *   2. else normalize BOTH sides — collapse whitespace runs to a single space,
 *      lowercase, fold typographic punctuation to ASCII (curly quotes → ' / ",
 *      ellipsis … → ..., em/en dash — – → -) — and find the normalized match,
 *      mapping the normalized index back to the original text index via a
 *      per-normalized-char index map;
 *   3. else a substring fallback: search for a distinctive window of the
 *      normalized quote (the first ~8 words, then the last ~8 words). This
 *      catches anchors the LLM truncated/extended or whose trailing clause it
 *      reworded;
 *   4. else null.
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
 * Start offsets of each paragraph in `text` (split on blank lines, `\n\n`).
 * Always includes 0. Used by the planner to place fallback moments at real
 * paragraph boundaries when their anchor quote could not be resolved.
 */
export function paragraphOffsets(text: string): number[] {
  const offsets = [0];
  const sep = '\n\n';
  let from = 0;
  for (;;) {
    const idx = text.indexOf(sep, from);
    if (idx === -1) break;
    const start = idx + sep.length;
    if (start < text.length) offsets.push(start);
    from = start;
  }
  return offsets;
}

/**
 * Folds a single character to its normalized ASCII form. Returns the
 * replacement string (length may differ from 1, e.g. … → "..."); an empty
 * string means "drop this char" (unused here, kept for clarity).
 */
function foldChar(ch: string): string {
  switch (ch) {
    // Curly single quotes + prime → straight apostrophe.
    case '‘': // ‘
    case '’': // ’
    case '‚': // ‚
    case '′': // ′
      return "'";
    // Curly double quotes + double prime → straight double quote.
    case '“': // “
    case '”': // ”
    case '„': // „
    case '″': // ″
      return '"';
    // Ellipsis → three dots.
    case '…': // …
      return '...';
    // Em/en dash, figure dash, minus sign → hyphen.
    case '—': // —
    case '–': // –
    case '‒': // ‒
    case '−': // −
      return '-';
    default:
      return ch.toLowerCase();
  }
}

/**
 * Normalizes `text`, returning the normalized string plus a map from each
 * normalized character index to the index of the ORIGINAL character it came
 * from. Multi-char expansions (… → "...") map every produced char to the same
 * original index, so any normalized match position maps back to a real offset.
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
      inWhitespaceRun = false;
      const folded = foldChar(ch);
      for (const fch of folded) {
        chars.push(fch);
        map.push(i);
      }
    }
  }

  return { normalized: chars.join(''), map };
}

/** Normalizes a quote the same way (no index map needed), trimming edge fluff. */
function normalizeQuote(quote: string): string {
  let out = '';
  for (let i = 0; i < quote.length; i++) {
    const ch = quote[i] as string;
    out += /\s/.test(ch) ? ' ' : foldChar(ch);
  }
  // Collapse whitespace runs, then strip leading/trailing quote/dash/space fluff
  // the LLM commonly adds or drops around the sentence it keyed on.
  return out
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'\-\s]+/, '')
    .replace(/["'\-\s]+$/, '');
}

/** Words of a normalized quote, ignoring empties. */
function words(normalizedQuote: string): string[] {
  return normalizedQuote.split(' ').filter((w) => w.length > 0);
}

export function locateQuote(text: string, quote: string): number | null {
  // 1. Exact match.
  const exact = text.indexOf(quote);
  if (exact !== -1) {
    return paragraphStart(text, exact);
  }

  // 2. Normalized match (typographic + whitespace + case folded on both sides).
  const { normalized, map } = normalizeWithMap(text);
  const normalizedQuote = normalizeQuote(quote);
  if (normalizedQuote.length === 0) return null;

  const normIndex = normalized.indexOf(normalizedQuote);
  if (normIndex !== -1) {
    const originalIndex = map[normIndex];
    if (originalIndex !== undefined) return paragraphStart(text, originalIndex);
  }

  // 3. Substring fallback: a distinctive window of the quote — the LLM may have
  //    truncated/extended the sentence or reworded a trailing clause. Try the
  //    leading window first, then the trailing one.
  const WINDOW = 8;
  const qWords = words(normalizedQuote);
  if (qWords.length >= 3) {
    const head = qWords.slice(0, Math.min(WINDOW, qWords.length)).join(' ');
    const tail = qWords.slice(Math.max(0, qWords.length - WINDOW)).join(' ');
    for (const window of head === tail ? [head] : [head, tail]) {
      const hit = normalized.indexOf(window);
      if (hit !== -1) {
        const originalIndex = map[hit];
        if (originalIndex !== undefined) return paragraphStart(text, originalIndex);
      }
    }
  }

  // 4. Not found.
  return null;
}
