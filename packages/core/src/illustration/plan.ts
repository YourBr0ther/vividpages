/**
 * Per-chapter illustration planner: one LLM call → a ranked, quote-anchored set
 * of visual moments, each mapped back to a character offset in the chapter text
 * and to roster character ids. Pure orchestration (no DB IO); the caller
 * persists the returned points (see imagine Phase 0).
 */

import { completeStructured, type LLM } from '@vividpages/ai';

import { findRosterMatch } from '../analysis/roster';
import { locateQuote } from './locate';
import { buildIllustrationPlanPrompt } from './plan-prompt';
import { chapterPlanSchema } from './plan-schema';

export interface PlanChapter {
  id: string;
  text: string;
  title: string | null;
}

export interface PlanRosterMember {
  id: string;
  name: string;
  aliases: string[];
  /** Short visual description, when known. */
  oneLine: string | null;
}

export interface PlannedPoint {
  /** Placement order within the chapter, 0-based, ascending by charOffset. */
  idx: number;
  /** Paragraph-start char offset into the chapter text. */
  charOffset: number;
  /** Verbatim sentence the LLM keyed on (located the offset; debug aid). */
  anchorQuote: string;
  /** One filmable sentence describing the visual moment. */
  momentDescription: string;
  /** Roster ids of characters present (unmatched names are dropped). */
  presentCharacterIds: string[];
  /** LLM importance rank (1–5), surfaced as the point's score. */
  score: number;
}

export interface PlanChapterIllustrationsArgs {
  chapter: PlanChapter;
  roster: PlanRosterMember[];
  /** Upper bound on planned moments (a cap, not a floor). */
  maxMoments: number;
  llm: LLM;
  /** Optional book title for prompt context. */
  bookTitle?: string;
}

export interface PlanChapterIllustrationsResult {
  points: PlannedPoint[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * Plans illustration moments for a single chapter.
 *
 * 1. Structured LLM call (repair-retry, low temperature).
 * 2. Non-narrative → no points.
 * 3. Each moment: resolve its anchor quote to an offset (drop if unresolved)
 *    and its character names to roster ids (drop unmatched names; not fatal).
 * 4. Keep the top `maxMoments` by importance (stable tie-break on input order),
 *    then sort by `charOffset` ascending and assign contiguous `idx`.
 */
export async function planChapterIllustrations(
  args: PlanChapterIllustrationsArgs,
): Promise<PlanChapterIllustrationsResult> {
  const { chapter, roster, maxMoments, llm, bookTitle = '' } = args;

  const { system, prompt } = buildIllustrationPlanPrompt({
    chapterText: chapter.text,
    roster: roster.map((r) => ({ name: r.name, oneLine: r.oneLine })),
    maxMoments,
    bookTitle,
  });

  const result = await completeStructured(llm, {
    system,
    prompt,
    schema: chapterPlanSchema,
    maxAttempts: 3,
    temperature: 0.3,
  });

  const tokensIn = result.tokensIn;
  const tokensOut = result.tokensOut;

  if (!result.value.isNarrative) {
    return { points: [], tokensIn, tokensOut };
  }

  // Resolve each moment's anchor + characters; remember input order for stable
  // tie-breaking before we re-order by offset.
  interface Resolved {
    order: number;
    charOffset: number;
    anchorQuote: string;
    momentDescription: string;
    presentCharacterIds: string[];
    importance: number;
  }

  const resolved: Resolved[] = [];
  let dropped = 0;

  result.value.moments.forEach((moment, order) => {
    const charOffset = locateQuote(chapter.text, moment.anchorQuote);
    if (charOffset === null) {
      dropped += 1;
      return;
    }

    const presentCharacterIds: string[] = [];
    for (const name of moment.characters) {
      const match = findRosterMatch(roster, name);
      if (match && !presentCharacterIds.includes(match.id)) {
        presentCharacterIds.push(match.id);
      }
    }

    resolved.push({
      order,
      charOffset,
      anchorQuote: moment.anchorQuote,
      momentDescription: moment.description,
      presentCharacterIds,
      importance: moment.importance,
    });
  });

  if (dropped > 0) {
    // eslint-disable-next-line no-console
    console.debug(
      `[illustration.plan] chapter ${chapter.id}: dropped ${dropped} moment(s) with unresolvable anchor quotes`,
    );
  }

  // Keep the top `maxMoments` by importance desc, stable on input order.
  const kept = resolved
    .slice()
    .sort((a, b) => b.importance - a.importance || a.order - b.order)
    .slice(0, Math.max(0, maxMoments));

  // Place in reading order: sort by offset asc (stable tie-break on input
  // order) and assign contiguous idx.
  const points: PlannedPoint[] = kept
    .slice()
    .sort((a, b) => a.charOffset - b.charOffset || a.order - b.order)
    .map((m, idx) => ({
      idx,
      charOffset: m.charOffset,
      anchorQuote: m.anchorQuote,
      momentDescription: m.momentDescription,
      presentCharacterIds: m.presentCharacterIds,
      score: m.importance,
    }));

  return { points, tokensIn, tokensOut };
}
