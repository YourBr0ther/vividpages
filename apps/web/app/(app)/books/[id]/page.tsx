import type { BookStatus } from '@vividpages/db';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { auth } from '@/auth';
import { FallbackCover, SpineOverlay } from '@/components/book-cover-art';
import { ChapterList } from '@/components/chapter-list';
import { DangerZone } from '@/components/danger-zone';
import { STATUS_LABELS } from '@/lib/book-card-data';
import { findOwnedBook } from '@/lib/find-owned-book';
import { getReadingProgress, listChaptersWithScenes } from '@/lib/queries';
import { chapterLabel } from '@/lib/reader-types';

type PageProps = { params: Promise<{ id: string }> };

const numberFormat = new Intl.NumberFormat('en-US');

// Deduped across generateMetadata + the page render.
const loadOwnedBook = cache(async (id: string) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');
  return { userId, book: await findOwnedBook(id, userId) };
});

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const { book } = await loadOwnedBook(id);
  return { title: book ? `${book.title} · VividPages` : 'VividPages' };
}

function statusChipClass(status: BookStatus): string {
  if (status === 'ready') return 'border-ember-400/40 bg-ember-400/10 text-ember-300';
  if (status === 'failed') return 'border-red-400/40 bg-red-950/60 text-red-300';
  return 'border-stone-700 bg-stone-900/70 text-stone-400';
}

/**
 * The book's title page: cover, metadata, the way into the Reader, the table
 * of contents, future pipeline controls, and the danger zone.
 */
export default async function BookDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { userId, book } = await loadOwnedBook(id);
  if (!book) notFound();

  const [chapters, progress] = await Promise.all([
    listChaptersWithScenes(book.id),
    getReadingProgress(userId, book.id),
  ]);
  const sceneCount = chapters.reduce((total, chapter) => total + chapter.sceneCount, 0);
  const readable = chapters.length > 0;
  const continueChapter = progress
    ? chapters.find((chapter) => chapter.idx === progress.chapterIdx)
    : undefined;

  const stats = [
    book.wordCount != null ? `${numberFormat.format(book.wordCount)} words` : null,
    `${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}`,
    `${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'}`,
  ].filter((stat): stat is string => stat !== null);

  return (
    <div className="animate-rise">
      <nav aria-label="Breadcrumb">
        <Link
          href="/"
          className="text-sm text-stone-500 transition hover:text-parchment focus-visible:ring-2 focus-visible:ring-ember-400/70"
        >
          ← The Bookcase
        </Link>
      </nav>

      <section className="mt-8 flex flex-col gap-10 sm:flex-row" aria-label="Book">
        <div className="relative aspect-[2/3] w-44 shrink-0 self-start overflow-hidden rounded-[3px] bg-stone-900 shadow-[0_28px_56px_-20px_rgba(0,0,0,0.95)] ring-1 ring-white/10 sm:w-56">
          {book.coverObjectKey ? (
            // Plain <img>: covers are private, per-user streamed objects.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/books/${book.id}/cover`}
              alt={`Cover of “${book.title}”`}
              className="h-full w-full object-cover"
            />
          ) : (
            <FallbackCover title={book.title} author={book.author} />
          )}
          <SpineOverlay />
        </div>

        <div className="min-w-0 flex-1 pt-1">
          <span
            className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${statusChipClass(book.status)}`}
          >
            {STATUS_LABELS[book.status]}
          </span>

          <h1 className="mt-4 text-balance font-display text-4xl tracking-tight text-parchment sm:text-5xl">
            {book.title}
          </h1>
          <p className="mt-3 text-lg text-stone-400">{book.author ?? 'Unknown author'}</p>

          <p className="mt-5 text-sm text-stone-500">
            {stats.map((stat, i) => (
              <span key={stat}>
                {i > 0 ? <span aria-hidden> · </span> : null}
                {stat}
              </span>
            ))}
          </p>

          <div className="mt-9">
            {readable ? (
              <Link
                href={`/books/${book.id}/read`}
                className="inline-flex items-center gap-2 rounded-full bg-ember-400 px-6 py-2.5 text-sm font-semibold text-stone-950 shadow-[0_10px_30px_-10px_rgba(224,155,59,0.55)] transition hover:bg-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
              >
                {continueChapter
                  ? `Continue reading — ${chapterLabel(continueChapter)}`
                  : 'Begin reading'}
                <span aria-hidden>→</span>
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title="The text isn't ready yet"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-stone-700 px-6 py-2.5 text-sm font-semibold text-stone-600"
              >
                Begin reading <span aria-hidden>→</span>
              </span>
            )}
          </div>
        </div>
      </section>

      <div
        aria-hidden
        className="mt-12 h-px w-full bg-gradient-to-r from-ember-400/40 via-stone-700/60 to-transparent"
      />

      <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ChapterList
          bookId={book.id}
          chapters={chapters}
          currentChapterIdx={progress?.chapterIdx}
        />

        <aside className="space-y-6">
          <section
            aria-label="Analysis and illustration"
            className="rounded-xl border border-stone-800/70 bg-stone-900/40 p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg tracking-tight text-parchment">
                Analysis &amp; illustration
              </h2>
              <span className="shrink-0 rounded-full border border-stone-700 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">
                Coming in M4
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-500">
              Scene analysis, the character cast, and illustrated storyboards will be run from
              here once the imagination pipeline lands.
            </p>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="mt-4 cursor-not-allowed rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-600"
            >
              Run analysis
            </button>
          </section>

          <DangerZone bookId={book.id} bookTitle={book.title} />
        </aside>
      </div>
    </div>
  );
}
