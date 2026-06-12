import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractChapterText, type ChapterText } from '../src/epub/text';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/** Asserts the structural invariants every ChapterText must satisfy. */
function assertInvariants(result: ChapterText): void {
  let prevEnd = -2;
  for (const p of result.paragraphs) {
    expect(p.start).toBeGreaterThanOrEqual(0);
    expect(p.end).toBeGreaterThan(p.start);
    // Non-overlapping, ascending, joined by exactly '\n\n'.
    if (prevEnd >= 0) {
      expect(p.start).toBe(prevEnd + 2);
      expect(result.text.slice(prevEnd, p.start)).toBe('\n\n');
    }
    const slice = result.text.slice(p.start, p.end);
    expect(slice).toBe(slice.trim());
    expect(slice.length).toBeGreaterThan(0);
    prevEnd = p.end;
  }
  if (result.paragraphs.length > 0) {
    expect(result.paragraphs[0]!.start).toBe(0);
    expect(result.paragraphs[result.paragraphs.length - 1]!.end).toBe(result.text.length);
  } else {
    expect(result.text).toBe('');
  }
  // Every scene break points at the start of a kept paragraph (never index 0).
  const starts = new Set(result.paragraphs.map((p) => p.start));
  for (const offset of result.sceneBreaks) {
    expect(starts.has(offset)).toBe(true);
    expect(offset).toBeGreaterThan(0);
  }
  expect([...result.sceneBreaks]).toEqual([...result.sceneBreaks].sort((a, b) => a - b));
  expect(new Set(result.sceneBreaks).size).toBe(result.sceneBreaks.length);
}

describe('extractChapterText (synthetic)', () => {
  it('extracts paragraphs with exact offsets joined by \\n\\n', () => {
    const r = extractChapterText('<p>First one.</p><p>Second one.</p><p>Third.</p>');
    expect(r.text).toBe('First one.\n\nSecond one.\n\nThird.');
    expect(r.paragraphs.map((p) => r.text.slice(p.start, p.end))).toEqual([
      'First one.',
      'Second one.',
      'Third.',
    ]);
    expect(r.sceneBreaks).toEqual([]);
    assertInvariants(r);
  });

  it('decodes entities: &amp;, &mdash;, &nbsp; as space', () => {
    const r = extractChapterText('<p>Tea &amp; cake&mdash;always.</p><p>a&nbsp;&nbsp;b</p>');
    expect(r.text).toBe('Tea & cake—always.\n\na b');
  });

  it('keeps curly quotes and em-dashes as-is', () => {
    const r = extractChapterText('<p>“It’s here”—she said.</p>');
    expect(r.text).toBe('“It’s here”—she said.');
  });

  it('leaves no markup behind', () => {
    const r = extractChapterText(
      '<p>One <span class="italic">two</span> three.</p><p>4 &lt; 5 is true</p>',
    );
    expect(r.text).toContain('One two three.');
    // Literal &lt; decodes to '<' as text content — that is data, not markup —
    // but no tag survives.
    expect(r.text).not.toMatch(/<\/?[a-z]/i);
  });

  it('collapses whitespace runs and trims paragraphs', () => {
    const r = extractChapterText('<p>\n   spaced \t out\n\n  text   </p>');
    expect(r.text).toBe('spaced out text');
  });

  it('converts <br> to a single space (documented behavior)', () => {
    const r = extractChapterText('<p>line one<br/>line two<br><br/>line three</p>');
    expect(r.text).toBe('line one line two line three');
    expect(r.paragraphs).toHaveLength(1);
  });

  it('drops empty paragraphs', () => {
    const r = extractChapterText('<p>A</p><p>   </p><p></p><p> </p><p>B</p>');
    expect(r.text).toBe('A\n\nB');
    expect(r.paragraphs).toHaveLength(2);
  });

  it('keeps headings as ordinary paragraphs', () => {
    const r = extractChapterText('<h1>Chapter 1</h1><h2>Part One</h2><p>Body text.</p>');
    expect(r.text).toBe('Chapter 1\n\nPart One\n\nBody text.');
  });

  it('treats blockquote and li as paragraphs', () => {
    const r = extractChapterText(
      '<blockquote>Quoted line.</blockquote><ul><li>alpha</li><li>beta</li></ul>',
    );
    expect(r.text).toBe('Quoted line.\n\nalpha\n\nbeta');
  });

  it('div with direct text is a leaf; div of blocks is a container', () => {
    const r = extractChapterText(
      '<div><p>Inside para.</p><div>Leaf div text.</div></div><div>Top leaf.</div>',
    );
    expect(r.text).toBe('Inside para.\n\nLeaf div text.\n\nTop leaf.');
    expect(r.paragraphs).toHaveLength(3);
    assertInvariants(r);
  });

  describe('scene breaks', () => {
    const markers = ['***', '* * *', '• • •', '⁂', '~', '~~~', '---', '——', '◆◆◆', '#', '…', '. . .'];
    it.each(markers)('decoration-only paragraph "%s" becomes a break', (marker) => {
      const r = extractChapterText(`<p>Before.</p><p>${marker}</p><p>After.</p>`);
      expect(r.text).toBe('Before.\n\nAfter.');
      expect(r.sceneBreaks).toEqual(['Before.\n\n'.length]);
      assertInvariants(r);
    });

    it('does not treat prose containing those characters as a break', () => {
      const r = extractChapterText('<p>Before.</p><p>Wait—no. *Stars*?</p><p>After.</p>');
      expect(r.sceneBreaks).toEqual([]);
      expect(r.paragraphs).toHaveLength(3);
    });

    it('<hr> is a break and is dropped from text', () => {
      const r = extractChapterText('<p>Scene one.</p><hr/><p>Scene two.</p>');
      expect(r.text).toBe('Scene one.\n\nScene two.');
      expect(r.sceneBreaks).toEqual(['Scene one.\n\n'.length]);
    });

    it.each(['scene-break', 'tb', 'text-break', 'body_-section-break', 'body_section-break_star'])(
      'class hint "%s" marks a break and drops the marker content',
      (cls) => {
        const r = extractChapterText(`<p>One.</p><p class="${cls}">…</p><p>Two.</p>`);
        expect(r.text).toBe('One.\n\nTwo.');
        expect(r.sceneBreaks).toEqual(['One.\n\n'.length]);
      },
    );

    it('does not misread unrelated classes (e.g. "tbody", "table") as break hints', () => {
      const r = extractChapterText(
        '<p>One.</p><p class="tbody-note">Real text.</p><p class="stable">More.</p>',
      );
      expect(r.sceneBreaks).toEqual([]);
      expect(r.paragraphs).toHaveLength(3);
    });

    it('collapses consecutive markers into one break', () => {
      const r = extractChapterText(
        '<p>A.</p><hr/><p>***</p><p class="scene-break"></p><p>B.</p>',
      );
      expect(r.text).toBe('A.\n\nB.');
      expect(r.sceneBreaks).toEqual(['A.\n\n'.length]);
    });

    it('drops a break at the very end silently', () => {
      const r = extractChapterText('<p>Only scene.</p><hr/><p>***</p>');
      expect(r.text).toBe('Only scene.');
      expect(r.sceneBreaks).toEqual([]);
    });

    it('drops a break before the first paragraph silently', () => {
      const r = extractChapterText('<hr/><p>First.</p><p>Second.</p>');
      expect(r.text).toBe('First.\n\nSecond.');
      expect(r.sceneBreaks).toEqual([]);
    });

    it('records multiple breaks at the right offsets', () => {
      const r = extractChapterText('<p>AA</p><hr/><p>BB</p><hr/><p>CC</p>');
      expect(r.text).toBe('AA\n\nBB\n\nCC');
      expect(r.sceneBreaks).toEqual([4, 8]);
    });
  });

  it('returns an empty result for empty/blank input', () => {
    expect(extractChapterText('')).toEqual({ text: '', paragraphs: [], sceneBreaks: [] });
    expect(extractChapterText('<div>  </div>')).toEqual({
      text: '',
      paragraphs: [],
      sceneBreaks: [],
    });
  });
});

describe('extractChapterText (real fixture chapters)', () => {
  const names = ['chapter-early.xhtml', 'chapter-middle.xhtml', 'chapter-late.xhtml'];

  it.each(names)('%s: offsets roundtrip and text is clean', (name) => {
    const r = extractChapterText(fixture(name));
    expect(r.paragraphs.length).toBeGreaterThan(10);
    expect(r.text).not.toContain('<');
    assertInvariants(r);
  });

  it('chapter-early starts with the Prologue heading paragraph', () => {
    const r = extractChapterText(fixture('chapter-early.xhtml'));
    const first = r.text.slice(r.paragraphs[0]!.start, r.paragraphs[0]!.end);
    expect(first).toBe('Prologue');
    expect(r.text).toContain('It was an ordinary day when Evie met The Villain.');
  });

  it('chapter-middle keeps the POV marker paragraph and curly punctuation', () => {
    const r = extractChapterText(fixture('chapter-middle.xhtml'));
    expect(r.text).toContain('The Villain');
    expect(r.text).toMatch(/[‘’“”—]/);
  });
});
