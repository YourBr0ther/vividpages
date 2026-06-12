import Link from 'next/link';

import { chapterLabel, type ChapterMeta } from '@/lib/reader-types';

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * The book's table of contents. Server-renderable; each row deep-links into
 * the Reader at that chapter. `currentChapterIdx` marks the saved reading
 * position with a small "Reading" tag.
 */
export function ChapterList({
  bookId,
  chapters,
  currentChapterIdx,
}: {
  bookId: string;
  chapters: ChapterMeta[];
  currentChapterIdx?: number;
}) {
  if (chapters.length === 0) {
    return (
      <section aria-label="Chapters">
        <h2 className="font-display text-2xl tracking-tight text-parchment">Contents</h2>
        <p className="mt-4 text-sm text-stone-500">
          No chapters yet — this book is still being prepared.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Chapters">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl tracking-tight text-parchment">Contents</h2>
        <span className="text-xs text-stone-500">
          {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}
        </span>
      </div>
      <ol className="mt-5 border-y border-stone-800/60">
        {chapters.map((chapter) => {
          const isCurrent = currentChapterIdx === chapter.idx;
          return (
            <li key={chapter.idx} className="border-b border-stone-800/40 last:border-b-0">
              <Link
                href={`/books/${bookId}/read?chapter=${chapter.idx}`}
                className="group flex items-baseline gap-4 rounded-sm px-2 py-3.5 outline-none transition hover:bg-stone-900/60 focus-visible:ring-2 focus-visible:ring-ember-400/70"
              >
                <span className="w-7 shrink-0 text-right font-display text-sm tabular-nums text-ember-400/80">
                  {chapter.idx + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-stone-300 transition group-hover:text-parchment">
                  {chapterLabel(chapter)}
                  {isCurrent ? (
                    <span className="ml-3 rounded-full border border-ember-400/40 bg-ember-400/10 px-2 py-0.5 align-middle text-[10px] font-medium uppercase tracking-[0.15em] text-ember-300">
                      Reading
                    </span>
                  ) : null}
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums text-stone-500 sm:inline">
                  {chapter.wordCount != null
                    ? `${numberFormat.format(chapter.wordCount)} words · `
                    : ''}
                  {chapter.sceneCount} {chapter.sceneCount === 1 ? 'scene' : 'scenes'}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
