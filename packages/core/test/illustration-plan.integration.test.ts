import { describe, expect, it, vi } from 'vitest';
import { OllamaLLM, type LLM } from '@vividpages/ai';

import {
  planChapterIllustrations,
  type PlanRosterMember,
} from '../src/illustration/plan';

const OLLAMA_URL = process.env.OLLAMA_URL;
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';

/** A roster used by both the unit and integration tests. */
const ROSTER: PlanRosterMember[] = [
  {
    id: 'id-mara',
    name: 'Mara',
    aliases: ['the captain'],
    oneLine: 'a weathered starship captain with close-cropped silver hair',
  },
  {
    id: 'id-jonas',
    name: 'Jonas',
    aliases: [],
    oneLine: 'a young, anxious engineer in a grease-stained jumpsuit',
  },
];

/**
 * A short multi-paragraph narrative chapter. Paragraphs are separated by blank
 * lines so locateQuote can snap to paragraph starts.
 */
const CHAPTER_TEXT = [
  'The airlock hissed open and Mara stepped onto the cracked landing pad, her boots crunching on frost.',
  '',
  'Jonas crouched beside the failing reactor, sparks dancing across his goggles as he wrenched a panel free.',
  '',
  '"We have minutes, not hours," Mara said, drawing her sidearm and scanning the smoke-filled corridor.',
  '',
  'Far below, the city lights flickered and died, plunging the valley into a deep and sudden darkness.',
  '',
  'When the emergency beacon finally flared red, Jonas and Mara exchanged a single, exhausted glance and ran for the shuttle.',
].join('\n');

/** Builds a fake LLM that returns a fixed JSON body for the structured call. */
function fakeLLM(body: unknown): LLM {
  return {
    provider: 'fake',
    model: 'fake',
    complete: vi.fn(async () => ({
      text: JSON.stringify(body),
      tokensIn: 11,
      tokensOut: 22,
    })),
    healthCheck: vi.fn(async () => ({ ok: true })),
  };
}

const CHAPTER = { id: 'ch-1', title: 'Chapter 1', text: CHAPTER_TEXT };

describe('planChapterIllustrations (unit, fake LLM)', () => {
  it('returns no points when the chapter is non-narrative', async () => {
    const llm = fakeLLM({ isNarrative: false, moments: [] });
    const out = await planChapterIllustrations({
      chapter: CHAPTER,
      roster: ROSTER,
      maxMoments: 3,
      llm,
    });
    expect(out.points).toEqual([]);
    expect(out.tokensIn).toBe(11);
    expect(out.tokensOut).toBe(22);
  });

  it('drops moments whose anchor quote does not resolve', async () => {
    const llm = fakeLLM({
      isNarrative: true,
      moments: [
        {
          anchorQuote: 'this sentence is nowhere in the chapter',
          description: 'a ghost moment',
          characters: ['Mara'],
          importance: 5,
        },
        {
          anchorQuote: 'Jonas crouched beside the failing reactor',
          description: 'the engineer fights the reactor',
          characters: ['Jonas'],
          importance: 4,
        },
      ],
    });
    const out = await planChapterIllustrations({
      chapter: CHAPTER,
      roster: ROSTER,
      maxMoments: 3,
      llm,
    });
    expect(out.points).toHaveLength(1);
    expect(out.points[0]!.momentDescription).toBe('the engineer fights the reactor');
    expect(out.points[0]!.presentCharacterIds).toEqual(['id-jonas']);
  });

  it('resolves character names + aliases and drops unmatched names', async () => {
    const llm = fakeLLM({
      isNarrative: true,
      moments: [
        {
          anchorQuote: 'The airlock hissed open and Mara stepped onto the cracked landing pad',
          description: 'the captain disembarks',
          // 'the captain' is an alias of Mara; 'Stranger' is unknown.
          characters: ['the captain', 'Stranger'],
          importance: 3,
        },
      ],
    });
    const out = await planChapterIllustrations({
      chapter: CHAPTER,
      roster: ROSTER,
      maxMoments: 3,
      llm,
    });
    expect(out.points).toHaveLength(1);
    expect(out.points[0]!.presentCharacterIds).toEqual(['id-mara']);
  });

  it('keeps top-N by importance, then orders by charOffset with contiguous idx', async () => {
    const llm = fakeLLM({
      isNarrative: true,
      moments: [
        // importance 5, near the END of the chapter
        {
          anchorQuote: 'When the emergency beacon finally flared red',
          description: 'beacon flares',
          characters: ['Mara', 'Jonas'],
          importance: 5,
        },
        // importance 2, should be dropped by maxMoments=2 (lowest)
        {
          anchorQuote: 'Far below, the city lights flickered and died',
          description: 'city goes dark',
          characters: [],
          importance: 2,
        },
        // importance 4, near the START of the chapter
        {
          anchorQuote: 'The airlock hissed open and Mara stepped onto the cracked landing pad',
          description: 'captain disembarks',
          characters: ['Mara'],
          importance: 4,
        },
      ],
    });
    const out = await planChapterIllustrations({
      chapter: CHAPTER,
      roster: ROSTER,
      maxMoments: 2,
      llm,
    });
    expect(out.points).toHaveLength(2);
    // Sorted by offset: 'captain disembarks' (start) before 'beacon flares' (end).
    expect(out.points.map((p) => p.momentDescription)).toEqual([
      'captain disembarks',
      'beacon flares',
    ]);
    expect(out.points.map((p) => p.idx)).toEqual([0, 1]);
    expect(out.points[0]!.charOffset).toBeLessThan(out.points[1]!.charOffset);
    // 'city goes dark' (importance 2) was dropped by the cap.
    expect(out.points.map((p) => p.score)).toEqual([4, 5]);
  });
});

describe.skipIf(!OLLAMA_URL)('planChapterIllustrations (integration, live Ollama)', () => {
  it('plans resolvable points against the live model', async (ctx) => {
    const llm = new OllamaLLM({ baseUrl: OLLAMA_URL!, model: MODEL });
    const health = await llm.healthCheck();
    if (!health.ok) {
      console.warn(`[illustration-plan.integration] model not ready: ${health.detail}`);
      ctx.skip();
      return;
    }

    const out = await planChapterIllustrations({
      chapter: CHAPTER,
      roster: ROSTER,
      maxMoments: 3,
      llm,
      bookTitle: 'The Frost Run',
    });

    console.log(
      `[illustration-plan.integration] points=${out.points.length} tokensIn=${out.tokensIn} tokensOut=${out.tokensOut}`,
    );
    for (const p of out.points) {
      console.log(
        `  idx=${p.idx} off=${p.charOffset} score=${p.score} chars=[${p.presentCharacterIds.join(',')}]\n    anchor: ${JSON.stringify(p.anchorQuote)}\n    desc:   ${p.momentDescription}`,
      );
    }

    const rosterIds = new Set(ROSTER.map((r) => r.id));
    expect(out.points.length).toBeGreaterThanOrEqual(1);
    expect(out.points.length).toBeLessThanOrEqual(3);
    out.points.forEach((p, i) => {
      expect(p.idx).toBe(i); // contiguous from 0
      expect(p.charOffset).toBeGreaterThanOrEqual(0);
      expect(p.charOffset).toBeLessThan(CHAPTER_TEXT.length);
      for (const id of p.presentCharacterIds) {
        expect(rosterIds.has(id)).toBe(true);
      }
    });
    // Offsets must be non-decreasing (sorted for placement).
    for (let i = 1; i < out.points.length; i++) {
      expect(out.points[i]!.charOffset).toBeGreaterThanOrEqual(out.points[i - 1]!.charOffset);
    }
    expect(out.tokensIn).toBeGreaterThan(0);
    expect(out.tokensOut).toBeGreaterThan(0);
  }, 180_000);
});
