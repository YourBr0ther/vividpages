/**
 * Per-chapter illustration planner: one LLM call → a ranked, quote-anchored set
 * of visual moments, each mapped back to a character offset in the chapter text
 * and to roster character ids. Pure orchestration (no DB IO); the caller
 * persists the returned points (see imagine Phase 0).
 */

import { completeStructured, type LLM } from '@vividpages/ai';

import { findRosterMatch } from '../analysis/roster';
import { locateQuote, paragraphOffsets } from './locate';
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
  /** When true (opt-in, per-book), pass the mature fidelity instruction down. */
  mature?: boolean;
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
 * 2. Non-narrative → no points (this exclusion path is intentional).
 * 3. Each moment: resolve its anchor quote to an offset and its character names
 *    to roster ids (drop unmatched names; not fatal). Unresolvable anchors are
 *    NOT dropped — they are assigned a fallback offset (see below) so a
 *    narrative chapter never silently loses all its moments to anchor failure.
 * 4. Keep the top `maxMoments` by importance (stable tie-break on input order),
 *    then sort by `charOffset` ascending and assign contiguous `idx`.
 *
 * Fallback placement: unresolvable moments are spread evenly across the
 * chapter's paragraph-start offsets (proportional to their kept order),
 * skipping offsets already taken by resolved moments or earlier fallbacks.
 * Invariant: a narrative chapter that planned K moments yields K points.
 */
export async function planChapterIllustrations(
  args: PlanChapterIllustrationsArgs,
): Promise<PlanChapterIllustrationsResult> {
  const { chapter, roster, maxMoments, llm, bookTitle = '', mature = false } = args;

  const { system, prompt } = buildIllustrationPlanPrompt({
    chapterText: chapter.text,
    roster: roster.map((r) => ({ name: r.name, oneLine: r.oneLine })),
    maxMoments,
    bookTitle,
    mature,
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
  // tie-breaking before we re-order by offset. Unresolved moments get
  // charOffset=null here and are assigned a fallback offset afterwards so they
  // are never silently dropped.
  interface Resolved {
    order: number;
    charOffset: number | null;
    anchorQuote: string;
    momentDescription: string;
    presentCharacterIds: string[];
    importance: number;
  }

  const resolved: Resolved[] = [];
  let resolvedCount = 0;

  result.value.moments.forEach((moment, order) => {
    const charOffset = locateQuote(chapter.text, moment.anchorQuote);
    if (charOffset !== null) resolvedCount += 1;

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

  // Assign fallback offsets to unresolved moments: spread them across the
  // chapter's paragraph-start offsets, skipping any offset already taken by a
  // resolved moment (or an earlier fallback). Keeps offsets distinct so dedupe
  // never collapses two distinct moments onto each other.
  const unresolved = resolved.filter((r) => r.charOffset === null);
  if (unresolved.length > 0) {
    const paraOffsets = paragraphOffsets(chapter.text);
    const taken = new Set<number>(
      resolved.filter((r) => r.charOffset !== null).map((r) => r.charOffset as number),
    );
    const free = paraOffsets.filter((o) => !taken.has(o));
    // Candidate offsets, preferring unused paragraph starts; fall back to all
    // paragraph starts (then 0) if every paragraph is already taken.
    const candidates = free.length > 0 ? free : paraOffsets.length > 0 ? paraOffsets : [0];

    unresolved.forEach((moment, i) => {
      // Spread proportionally across the candidate paragraph starts.
      const pos =
        unresolved.length === 1
          ? Math.floor(candidates.length / 2)
          : Math.round((i / (unresolved.length - 1)) * (candidates.length - 1));
      let pick = candidates[Math.min(pos, candidates.length - 1)] as number;
      // Ensure distinctness against already-assigned fallbacks.
      while (taken.has(pick)) {
        const next = candidates.find((o) => !taken.has(o));
        if (next === undefined) break; // ran out of distinct slots; accept overlap
        pick = next;
      }
      moment.charOffset = pick;
      taken.add(pick);
    });
  }

  const fallbackCount = unresolved.length;
  if (fallbackCount > 0) {
    // eslint-disable-next-line no-console
    console.debug(
      `[illustration.plan] chapter ${chapter.id}: ${resolvedCount} moment(s) resolved, `
        + `${fallbackCount} placed via fallback offset (unresolvable anchor quotes)`,
    );
  }

  // Every moment now has a concrete offset (resolved or fallback). Narrow the
  // type for the placement step.
  interface Placed extends Resolved {
    charOffset: number;
  }
  const placed: Placed[] = resolved.map((m) => ({
    ...m,
    charOffset: m.charOffset ?? 0,
  }));

  // Keep the top `maxMoments` by importance desc, stable on input order.
  const kept = placed
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
