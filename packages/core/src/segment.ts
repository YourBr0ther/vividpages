import type { ChapterText } from './epub/text';

export interface SegmentOptions {
  /** Preferred scene length in words. Default 1200. */
  targetWords?: number;
  /** Hard ceiling; segments above this get split at paragraph boundaries. Default 1800. */
  maxWords?: number;
  /** Final fragments below this merge into the previous scene. Default 150. */
  minTailWords?: number;
  /**
   * A whole hard-cut (explicit-break) segment below this merges into the
   * previous scene across the break. Deliberately lower than minTailWords:
   * an author-intended short scene after '***' (e.g. a 100-word epilogue)
   * stays separate; only marker noise / stray fragments merge. Default 50.
   */
  minHardSegmentWords?: number;
}

export interface SceneSpan {
  /** Char offset of the scene's first paragraph start in ChapterText.text. */
  startOffset: number;
  /** Char offset of the scene's last paragraph end (the joining '\n\n' between scenes belongs to neither). */
  endOffset: number;
  /** Whitespace-split word count of the span's text. */
  wordCount: number;
}

const DEFAULTS = {
  targetWords: 1200,
  maxWords: 1800,
  minTailWords: 150,
  minHardSegmentWords: 50,
} as const;

/**
 * Paragraphs starting with a narrative transition cue make better scene
 * openings, so word-count splits prefer them near the target boundary.
 */
const TRANSITION_CUE_RE =
  /^(later|that (night|evening|morning|afternoon)|the next (morning|day|night|week)|meanwhile|hours later|by the time|when (he|she|they) (woke|returned|arrived))\b/i;

/** How far (in paragraphs) a transition cue may pull a cut from the nearest boundary. */
const CUE_WINDOW = 3;

/** A scene as a half-open range [start, end) of paragraph indices. */
interface ParaRange {
  start: number;
  end: number;
}

/** Per-paragraph data precomputed once per segmentChapter call. */
interface ParaStats {
  /** words[i]: whitespace-split word count of paragraph i. */
  words: number[];
  /** cue[i]: paragraph i starts with a transition cue. */
  cue: boolean[];
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sum(words: number[], start: number, end: number): number {
  let total = 0;
  for (let i = start; i < end; i++) total += words[i]!;
  return total;
}

/**
 * Deterministically segments a chapter into scenes:
 *
 * 1. Hard-cut at every explicit scene break (each break offset is the start
 *    of the paragraph that opens the next scene; the previous scene ends at
 *    the end of the paragraph before it).
 * 2. Split oversized segments greedily at paragraph boundaries near
 *    multiples of targetWords, preferring transition-cue paragraphs within
 *    ±CUE_WINDOW paragraphs (a cue never pushes a piece over maxWords).
 * 3. Merge tails under minTailWords into the previous scene. Whole hard-cut
 *    segments merge across their explicit break only when under the separate
 *    minHardSegmentWords threshold (default 50) — explicit breaks signal
 *    author intent, so a short-but-real scene (e.g. a 100-word epilogue
 *    after '***') stays separate while marker noise still collapses. (A tiny
 *    FIRST segment has no predecessor and stays separate.)
 *
 * Scenes cover every paragraph exactly once, in order, without overlap. A
 * single paragraph longer than maxWords cannot be split and is allowed
 * through as one oversized scene.
 */
export function segmentChapter(input: ChapterText, opts?: SegmentOptions): SceneSpan[] {
  const { targetWords, maxWords, minTailWords, minHardSegmentWords } = { ...DEFAULTS, ...opts };
  const { paragraphs, text, sceneBreaks } = input;
  if (paragraphs.length === 0) return [];

  // Word count of a span = sum over its paragraphs (paragraphs are joined by
  // whitespace, so whitespace-splitting the span text gives the same number).
  const stats: ParaStats = {
    words: paragraphs.map((p) => countWords(text.slice(p.start, p.end))),
    cue: paragraphs.map((p) => TRANSITION_CUE_RE.test(text.slice(p.start, p.end))),
  };

  // 1. Hard cuts: each scene break offset is the start of some paragraph.
  const startToIndex = new Map(paragraphs.map((p, i) => [p.start, i]));
  const hardStarts = [...new Set(sceneBreaks.map((o) => startToIndex.get(o)))]
    .filter((i): i is number => i !== undefined && i > 0)
    .sort((a, b) => a - b);

  const hardSegments: ParaRange[] = [];
  let segStart = 0;
  for (const cut of hardStarts) {
    hardSegments.push({ start: segStart, end: cut });
    segStart = cut;
  }
  hardSegments.push({ start: segStart, end: paragraphs.length });

  // 2 + 3. Split oversized hard segments, then merge tiny tails/segments.
  const scenes: ParaRange[] = [];
  for (const segment of hardSegments) {
    const segmentWords = sum(stats.words, segment.start, segment.end);

    // A hard-cut segment below minHardSegmentWords merges into the previous
    // scene (even across the explicit break) when one exists. This threshold
    // is intentionally lower than minTailWords: explicit breaks are author
    // intent, so short-but-real scenes survive.
    if (segmentWords < minHardSegmentWords && scenes.length > 0) {
      scenes[scenes.length - 1]!.end = segment.end;
      continue;
    }

    const pieces = splitByWordCount(segment, stats, { targetWords, maxWords });

    // Merge a final fragment under minTailWords into its predecessor within
    // the same hard-cut segment (may slightly exceed maxWords; preferable to
    // a dangling fragment).
    const last = pieces[pieces.length - 1];
    if (pieces.length > 1 && last && sum(stats.words, last.start, last.end) < minTailWords) {
      pieces[pieces.length - 2]!.end = last.end;
      pieces.pop();
    }
    scenes.push(...pieces);
  }

  return scenes.map(({ start, end }) => ({
    startOffset: paragraphs[start]!.start,
    endOffset: paragraphs[end - 1]!.end,
    wordCount: sum(stats.words, start, end),
  }));
}

/**
 * Greedily splits one hard segment at paragraph boundaries: each cut lands on
 * the boundary whose cumulative word count is closest to targetWords. A
 * segment with no internal boundary (single paragraph) is returned whole even
 * if oversized.
 */
function splitByWordCount(
  segment: ParaRange,
  stats: ParaStats,
  opts: { targetWords: number; maxWords: number },
): ParaRange[] {
  const pieces: ParaRange[] = [];
  let start = segment.start;

  while (sum(stats.words, start, segment.end) > opts.maxWords && segment.end - start > 1) {
    const cut = pickCut(start, segment.end, stats, opts);
    pieces.push({ start, end: cut });
    start = cut;
  }
  pieces.push({ start, end: segment.end });
  return pieces;
}

/**
 * Chooses the cut index c in (start, end) — the piece becomes [start, c) —
 * closest to targetWords, preferring a transition-cue paragraph within
 * ±CUE_WINDOW of that boundary (closest cue wins; a cue that would push the
 * piece over maxWords is ignored).
 */
function pickCut(
  start: number,
  end: number,
  stats: ParaStats,
  { targetWords, maxWords }: { targetWords: number; maxWords: number },
): number {
  let nearest = start + 1;
  let nearestDiff = Infinity;
  let cum = 0;
  for (let c = start + 1; c < end; c++) {
    cum += stats.words[c - 1]!;
    const diff = Math.abs(cum - targetWords);
    if (diff < nearestDiff) {
      nearest = c;
      nearestDiff = diff;
    }
  }

  let best = nearest;
  let bestDist = Infinity;
  for (let c = nearest - CUE_WINDOW; c <= nearest + CUE_WINDOW; c++) {
    if (c <= start || c >= end || !stats.cue[c]) continue;
    if (sum(stats.words, start, c) > maxWords) continue; // cue may not overflow the piece
    const dist = Math.abs(c - nearest);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}
