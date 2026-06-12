import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';

export interface ChapterText {
  /** Clean plain text, paragraphs joined with '\n\n'. */
  text: string;
  /** Char offsets into `text`; `text.slice(start, end)` is exactly the paragraph. */
  paragraphs: Array<{ start: number; end: number }>;
  /**
   * Char offsets of the paragraph that FOLLOWS an explicit scene break.
   * Marker paragraphs themselves are dropped from `text`. Breaks with no
   * following paragraph (at the end, or before the first kept paragraph)
   * are dropped silently; consecutive markers collapse into one break.
   */
  sceneBreaks: number[];
}

/** Block-level element names we recurse into looking for paragraph leaves. */
const CONTAINER_TAGS = new Set([
  'body',
  'html',
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'figure',
  'ul',
  'ol',
  'table',
  'tbody',
  'thead',
  'tr',
  'td',
  'th',
  'nav',
  'blockquote',
]);

/** Element names that are always paragraph leaves. */
const LEAF_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);

/** Block-level tags used to decide whether a div/blockquote is a container. */
const BLOCK_TAGS = new Set([...CONTAINER_TAGS, ...LEAF_TAGS, 'hr', 'pre']);

/**
 * Decoration-only paragraph: asterisms, bullets, dashes, tildes, dots,
 * ellipses etc. — no letters or digits, short. The literal '.' is included
 * because many books typeset asterism substitutes out of plain periods,
 * e.g. ". . ." or "...".
 */
const DECORATION_RE = /^[*•⁂~\-—–◆#.…\s]{1,20}$/;

/**
 * Class hints that mark an element as a scene-break ornament. Matched as a
 * token delimited by start/end, whitespace, '_' or '-' so that e.g.
 * "body_-section-break" and "body_section-break_star" match but "tbody" and
 * "stable" do not.
 */
const BREAK_CLASS_RE = /(?:^|[\s_-])(?:scene-?break|section-?break|text-?break|tb)(?=[\s_-]|$)/i;

/** Normalizes paragraph text: collapse whitespace runs, trim. Entities are
 * already decoded by cheerio; curly quotes and em-dashes are kept as-is. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Callers pass normalize()d text and check truthiness first, so the input is
 * always non-empty and trimmed (contains a non-space char) — no /\S/ guard. */
function isDecorationOnly(text: string): boolean {
  return DECORATION_RE.test(text);
}

function hasBreakClassHint(node: Cheerio<AnyNode>): boolean {
  const cls = node.attr('class');
  return cls != null && BREAK_CLASS_RE.test(cls);
}

/**
 * Extracts the visible text of a leaf element with `<br>` collapsed to a
 * single space (documented choice: a soft line break inside a paragraph is
 * treated as ordinary inter-word whitespace, then whitespace-normalized).
 */
function leafText(node: Cheerio<AnyNode>): string {
  const clone = node.clone();
  clone.find('br').replaceWith(' ');
  return normalize(clone.text());
}

/** True if the element directly contains any block-level child element. */
function hasBlockChildren(node: Cheerio<AnyNode>): boolean {
  return node
    .children()
    .toArray()
    .some((el) => el.type === 'tag' && BLOCK_TAGS.has(el.tagName.toLowerCase()));
}

/**
 * Extracts clean plain text plus paragraph offsets and scene-break positions
 * from a chapter's (X)HTML.
 *
 * - Paragraph leaves: <p>, <h1>-<h6>, <li>, plus <div>/<blockquote> elements
 *   that directly contain text rather than other blocks.
 * - Scene breaks: <hr>, decoration-only paragraphs (***, • • •, …, etc.) and
 *   elements whose class hints a break (scene-break, tb, section-break, …).
 *   A break-hinted element with real content keeps that content; the break
 *   lands before its first kept paragraph.
 */
export function extractChapterText(html: string): ChapterText {
  const $ = cheerio.load(html);

  const paragraphs: string[] = [];
  /** Paragraph indices that have an explicit break immediately before them. */
  const breakBeforePara = new Set<number>();
  let pendingBreak = false;

  const pushParagraph = (text: string): void => {
    if (!text) return; // drop empty paragraphs
    if (pendingBreak && paragraphs.length > 0) breakBeforePara.add(paragraphs.length);
    pendingBreak = false;
    paragraphs.push(text);
  };

  const markBreak = (): void => {
    pendingBreak = true; // leading/trailing/consecutive breaks resolve in pushParagraph
  };

  const visit = (node: AnyNode): void => {
    if (node.type !== 'tag') return;
    const el = $(node);
    const tag = node.tagName.toLowerCase();

    if (tag === 'hr') {
      markBreak();
      return;
    }
    // A break-class hint marks a scene boundary but never swallows content:
    // processing falls through, so a hinted container's paragraphs — and a
    // hinted <p>'s real prose — are kept, with the break recorded before the
    // first kept paragraph (documented choice). Marker-only hinted elements
    // (empty, or decoration-only like "***") contribute no paragraph and thus
    // act as pure breaks, exactly as before.
    if (hasBreakClassHint(el)) markBreak();
    if (LEAF_TAGS.has(tag)) {
      const text = leafText(el);
      if (text && isDecorationOnly(text)) markBreak();
      else pushParagraph(text);
      return;
    }
    if (tag === 'div' || tag === 'blockquote') {
      if (hasBlockChildren(el)) {
        el.children()
          .toArray()
          .forEach(visit);
      } else {
        const text = leafText(el);
        if (text && isDecorationOnly(text)) markBreak();
        else pushParagraph(text);
      }
      return;
    }
    if (CONTAINER_TAGS.has(tag)) {
      el.children()
        .toArray()
        .forEach(visit);
    }
    // Unknown/inline elements at block level are ignored.
  };

  $('body')
    .children()
    .toArray()
    .forEach(visit);

  // Assemble text + offsets: paragraphs joined by exactly '\n\n'.
  let text = '';
  const offsets: ChapterText['paragraphs'] = [];
  const sceneBreaks: number[] = [];
  paragraphs.forEach((p, i) => {
    if (i > 0) text += '\n\n';
    const start = text.length;
    text += p;
    offsets.push({ start, end: text.length });
    if (breakBeforePara.has(i)) sceneBreaks.push(start);
  });

  return { text, paragraphs: offsets, sceneBreaks };
}
