import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEpub } from '../src/epub/parse';
import { extractChapterText, type ChapterText } from '../src/epub/text';
import { segmentChapter, type SceneSpan } from '../src/segment';

/** A paragraph of exactly n words ("w1 w2 … wn"), optionally with a prefix
 * that replaces the first words (keeping the total word count at n). */
function para(n: number, prefix = ''): string {
  const prefixWords = prefix ? prefix.split(/\s+/).length : 0;
  const filler = Array.from({ length: n - prefixWords }, (_, i) => `w${i + 1}`);
  return [prefix, ...filler].filter(Boolean).join(' ');
}

/** Builds a ChapterText from paragraph strings; breakBefore lists paragraph
 * indices that have an explicit scene break immediately before them. */
function chapter(paras: string[], breakBefore: number[] = []): ChapterText {
  let text = '';
  const paragraphs: ChapterText['paragraphs'] = [];
  const sceneBreaks: number[] = [];
  paras.forEach((p, i) => {
    if (i > 0) text += '\n\n';
    const start = text.length;
    text += p;
    paragraphs.push({ start, end: text.length });
    if (breakBefore.includes(i)) sceneBreaks.push(start);
  });
  return { text, paragraphs, sceneBreaks };
}

function sceneText(input: ChapterText, scene: SceneSpan): string {
  return input.text.slice(scene.startOffset, scene.endOffset);
}

/** Asserts every paragraph belongs to exactly one scene, scenes ascending and
 * non-overlapping, spans aligned to paragraph boundaries, word counts true. */
function assertInvariants(input: ChapterText, scenes: SceneSpan[]): void {
  if (input.paragraphs.length === 0) {
    expect(scenes).toEqual([]);
    return;
  }
  expect(scenes.length).toBeGreaterThanOrEqual(1);
  expect(scenes[0]!.startOffset).toBe(input.paragraphs[0]!.start);
  expect(scenes[scenes.length - 1]!.endOffset).toBe(
    input.paragraphs[input.paragraphs.length - 1]!.end,
  );

  const starts = new Map(input.paragraphs.map((p, i) => [p.start, i]));
  const ends = new Map(input.paragraphs.map((p, i) => [p.end, i]));
  let nextPara = 0;
  for (const scene of scenes) {
    expect(scene.endOffset).toBeGreaterThan(scene.startOffset);
    // Spans start/end exactly on paragraph boundaries…
    expect(starts.has(scene.startOffset)).toBe(true);
    expect(ends.has(scene.endOffset)).toBe(true);
    // …and cover paragraphs contiguously with no gaps or overlaps.
    expect(starts.get(scene.startOffset)).toBe(nextPara);
    nextPara = ends.get(scene.endOffset)! + 1;
    // Reported word count matches the span's actual text.
    const words = sceneText(input, scene).split(/\s+/).filter(Boolean).length;
    expect(scene.wordCount).toBe(words);
  }
  expect(nextPara).toBe(input.paragraphs.length);
}

describe('segmentChapter', () => {
  it('returns [] for empty input', () => {
    expect(segmentChapter(chapter([]))).toEqual([]);
  });

  it('keeps a small chapter as a single scene with default options', () => {
    const input = chapter([para(200), para(300), para(250)]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.wordCount).toBe(750);
    assertInvariants(input, scenes);
  });

  it('honors explicit scene breaks exactly (3 breaks -> 4 scenes)', () => {
    const paras = [para(200), para(200), para(200), para(200), para(200), para(200), para(200), para(200)];
    const input = chapter(paras, [2, 4, 7]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(4);
    expect(scenes.map((s) => s.startOffset)).toEqual([
      input.paragraphs[0]!.start,
      input.paragraphs[2]!.start,
      input.paragraphs[4]!.start,
      input.paragraphs[7]!.start,
    ]);
    expect(scenes.map((s) => s.endOffset)).toEqual([
      input.paragraphs[1]!.end,
      input.paragraphs[3]!.end,
      input.paragraphs[6]!.end,
      input.paragraphs[7]!.end,
    ]);
    expect(scenes.map((s) => s.wordCount)).toEqual([400, 400, 600, 200]);
    assertInvariants(input, scenes);
  });

  it('splits an unbroken chapter so no scene exceeds maxWords', () => {
    // 30 x 200 = 6000 words, no explicit breaks.
    const input = chapter(Array.from({ length: 30 }, () => para(200)));
    const scenes = segmentChapter(input);
    expect(scenes.length).toBeGreaterThan(1);
    for (const s of scenes) expect(s.wordCount).toBeLessThanOrEqual(1800);
    // Greedy targeting ~1200 words: expect scenes near the target.
    for (const s of scenes) expect(s.wordCount).toBeGreaterThanOrEqual(150);
    assertInvariants(input, scenes);
  });

  it('allows a single paragraph larger than maxWords as one oversized scene', () => {
    const input = chapter([para(2500)]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.wordCount).toBe(2500);
    assertInvariants(input, scenes);
  });

  it('cannot split an oversized segment made of one giant paragraph even amid others', () => {
    const input = chapter([para(100), para(2500), para(100)], [1, 2]);
    const scenes = segmentChapter(input);
    // Hard cuts isolate the giant paragraph; the 100-word neighbors are above
    // minHardSegmentWords (50) so they stay separate scenes.
    expect(scenes.length).toBeLessThanOrEqual(3);
    expect(Math.max(...scenes.map((s) => s.wordCount))).toBeGreaterThanOrEqual(2500);
    assertInvariants(input, scenes);
  });

  it('merges a final fragment smaller than minTailWords into the previous scene', () => {
    // 740 words > maxWords 700; greedy cuts at 600 leaving a 140-word tail,
    // below minTailWords 150 -> merged back (even though that exceeds maxWords;
    // a tiny dangling scene is worse than a slightly long one).
    const input = chapter([para(300), para(300), para(140)]);
    const scenes = segmentChapter(input, { targetWords: 600, maxWords: 700, minTailWords: 150 });
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.wordCount).toBe(740);
    assertInvariants(input, scenes);
  });

  it('merges a tiny hard-cut segment into the previous scene (documented: breaks between tiny fragments merge)', () => {
    const input = chapter([para(500), para(500), para(40)], [2]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.wordCount).toBe(1040);
    assertInvariants(input, scenes);
  });

  it('keeps a tiny FIRST hard-cut segment separate (no previous scene to merge into)', () => {
    const input = chapter([para(40), para(500)], [1]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(2);
    expect(scenes.map((s) => s.wordCount)).toEqual([40, 500]);
    assertInvariants(input, scenes);
  });

  it('prefers a transition-cue paragraph within ±3 paragraphs of the target boundary', () => {
    // 10 x 20 = 200 words; target 100 -> nearest boundary before paragraph 5.
    // Paragraph 7 starts with a cue; |cut| at 7 is within +3 -> cue wins.
    const paras = Array.from({ length: 10 }, (_, i) =>
      i === 7 ? para(20, 'The next morning') : para(20),
    );
    const input = chapter(paras);
    const scenes = segmentChapter(input, { targetWords: 100, maxWords: 150, minTailWords: 10 });
    expect(scenes).toHaveLength(2);
    expect(sceneText(input, scenes[1]!)).toMatch(/^The next morning/);
    expect(scenes.map((s) => s.wordCount)).toEqual([140, 60]);
    assertInvariants(input, scenes);
  });

  it('cuts at the exact nearest boundary when no cue is nearby', () => {
    const input = chapter(Array.from({ length: 10 }, () => para(20)));
    const scenes = segmentChapter(input, { targetWords: 100, maxWords: 150, minTailWords: 10 });
    expect(scenes).toHaveLength(2);
    expect(scenes.map((s) => s.wordCount)).toEqual([100, 100]);
    assertInvariants(input, scenes);
  });

  it('matches real transition cues at a word boundary (Later that day / Meanwhile, back at)', () => {
    for (const prefix of ['Later that day', 'Meanwhile, back at']) {
      const paras = Array.from({ length: 10 }, (_, i) => (i === 7 ? para(20, prefix) : para(20)));
      const input = chapter(paras);
      const scenes = segmentChapter(input, { targetWords: 100, maxWords: 150, minTailWords: 10 });
      expect(scenes).toHaveLength(2);
      expect(sceneText(input, scenes[1]!).startsWith(prefix)).toBe(true);
      expect(scenes.map((s) => s.wordCount)).toEqual([140, 60]);
      assertInvariants(input, scenes);
    }
  });

  it('does not treat words merely starting with a cue as cues (Lateral / Meanwhiles / By the timepiece)', () => {
    for (const prefix of ['Lateral movement drills', 'Meanwhiles abound here', 'By the timepiece tower']) {
      const paras = Array.from({ length: 10 }, (_, i) => (i === 7 ? para(20, prefix) : para(20)));
      const input = chapter(paras);
      const scenes = segmentChapter(input, { targetWords: 100, maxWords: 150, minTailWords: 10 });
      expect(scenes.map((s) => s.wordCount)).toEqual([100, 100]);
      assertInvariants(input, scenes);
    }
  });

  it('keeps a short-but-real scene after an explicit break separate (>= minHardSegmentWords)', () => {
    // 100-word epilogue-style scene after '***': author-intended, stays its own scene
    // even though it is under minTailWords (150).
    const input = chapter([para(500), para(500), para(100)], [2]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(2);
    expect(scenes.map((s) => s.wordCount)).toEqual([1000, 100]);
    assertInvariants(input, scenes);
  });

  it('still merges a sub-minHardSegmentWords fragment after an explicit break', () => {
    const input = chapter([para(500), para(500), para(30)], [2]);
    const scenes = segmentChapter(input);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.wordCount).toBe(1030);
    assertInvariants(input, scenes);
  });

  it('honors a custom minHardSegmentWords', () => {
    const input = chapter([para(500), para(500), para(100)], [2]);
    const scenes = segmentChapter(input, { minHardSegmentWords: 120 });
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.wordCount).toBe(1100);
    assertInvariants(input, scenes);
  });

  it('ignores a cue candidate that would push the scene over maxWords', () => {
    // Nearest boundary 5 (100 words); cue at 8 would make a 160-word piece > 150.
    const paras = Array.from({ length: 10 }, (_, i) =>
      i === 8 ? para(20, 'Meanwhile') : para(20),
    );
    const input = chapter(paras);
    const scenes = segmentChapter(input, { targetWords: 100, maxWords: 150, minTailWords: 10 });
    expect(scenes.map((s) => s.wordCount)).toEqual([100, 100]);
    assertInvariants(input, scenes);
  });

  it('applies hard cuts before word-count splitting (oversized hard segment still splits)', () => {
    // Segment A: 3000 words (splits), segment B: 400 words (stays whole).
    const paras = [
      ...Array.from({ length: 10 }, () => para(300)),
      para(200),
      para(200),
    ];
    const input = chapter(paras, [10]);
    const scenes = segmentChapter(input);
    const last = scenes[scenes.length - 1]!;
    expect(last.startOffset).toBe(input.paragraphs[10]!.start);
    expect(last.wordCount).toBe(400);
    for (const s of scenes) expect(s.wordCount).toBeLessThanOrEqual(1800);
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    assertInvariants(input, scenes);
  });
});

describe('segmentChapter (real book)', () => {
  const FIXTURE_PATH = join(__dirname, 'fixtures/book.epub');

  it.skipIf(!existsSync(FIXTURE_PATH))(
    'segments all chapters of book.epub with invariants intact',
    async () => {
      const parsed = await parseEpub(readFileSync(FIXTURE_PATH));
      expect(parsed.chapters.length).toBeGreaterThanOrEqual(58);

      let totalScenes = 0;
      let totalWords = 0;
      let strippedHeadings = 0;
      let chaptersWithExplicitBreaks = 0;
      const distribution = new Map<number, number>();
      const oversized: string[] = [];

      for (const ch of parsed.chapters) {
        const text = extractChapterText(ch.html);
        expect(text.paragraphs.length).toBeGreaterThan(0);
        expect(text.text).not.toContain('<');
        // Embedded chapter headings (title + POV marker) are stripped, so the
        // text never re-starts with the ncx title ("Chapter 12", "Prologue"…).
        if (ch.title) expect(text.text.startsWith(ch.title)).toBe(false);
        strippedHeadings += text.leadingHeadings?.length ?? 0;
        totalWords += text.text.split(/\s+/).filter(Boolean).length;

        const scenes = segmentChapter(text);
        expect(scenes.length).toBeGreaterThanOrEqual(1);
        assertInvariants(text, scenes);
        if (text.sceneBreaks.length > 0) chaptersWithExplicitBreaks += 1;

        for (const s of scenes) {
          // Oversized scenes only permitted when unsplittable (single paragraph).
          if (s.wordCount > 1800) {
            const parasInScene = text.paragraphs.filter(
              (p) => p.start >= s.startOffset && p.end <= s.endOffset,
            );
            expect(parasInScene.length).toBe(1);
            oversized.push(`${ch.title ?? ch.idx}`);
          }
        }

        totalScenes += scenes.length;
        distribution.set(scenes.length, (distribution.get(scenes.length) ?? 0) + 1);
      }

      const dist = [...distribution.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([scenes, chapters]) => `${scenes} scene(s): ${chapters} chapters`)
        .join(', ');
      console.log(
        `[segment] ${parsed.chapters.length} chapters -> ${totalScenes} scenes | ${dist} | ` +
          `chapters with explicit break markers: ${chaptersWithExplicitBreaks} | oversized: ${oversized.length} | ` +
          `words: ${totalWords} | stripped leading headings: ${strippedHeadings}`,
      );

      // Sanity: roughly 1-4 scenes per chapter for this book.
      expect(totalScenes).toBeGreaterThanOrEqual(parsed.chapters.length);
      expect(totalScenes / parsed.chapters.length).toBeLessThanOrEqual(4);
    },
  );
});
