'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  STATUS_LABELS,
  isOpenableStatus,
  isTerminalStatus,
  type BookCardData,
} from '@/lib/book-card-data';
import { useBookProgress } from '@/lib/use-book-progress';

import { FallbackCover, SpineOverlay } from './book-cover-art';
import { ProgressRing } from './progress-ring';

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className={className} aria-hidden>
      <path d="M2.5 4h11M6.5 4V2.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V4M5 4l.6 9a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 4" />
    </svg>
  );
}

/**
 * One book on the shelf. Non-terminal books subscribe to SSE progress:
 * pre-readable stages (uploading/ingesting/segmenting) render a dimmed
 * blocking overlay with an animated ring, while enrichment stages
 * (analyzing/profiling/imagining) keep the book openable and show a small
 * corner progress badge instead. Failed books get an error face with retry
 * (placeholder) + delete; openable books link to the detail page.
 */
export function BookCard({
  book,
  onDeleteRequest,
  onStatusSettled,
}: {
  book: BookCardData;
  onDeleteRequest: (book: BookCardData) => void;
  /** Fired when live progress reaches ready/failed so the list can refresh. */
  onStatusSettled: (bookId: string) => void;
}) {
  const live = !isTerminalStatus(book.status);
  const progress = useBookProgress(live ? book.id : null);

  // Prefer live SSE values; fall back to the server snapshot.
  const status = progress.status ?? book.status;
  const percent = progress.percent ?? book.latestRun?.percent ?? null;
  const currentStep = progress.currentStep ?? book.latestRun?.currentStep ?? null;
  const error = progress.error ?? book.error ?? book.latestRun?.error ?? null;

  const settled = live && isTerminalStatus(status);
  useEffect(() => {
    if (settled) onStatusSettled(book.id);
  }, [settled, book.id, onStatusSettled]);

  const [coverFailed, setCoverFailed] = useState(false);
  const showCoverImage = book.hasCover && !coverFailed;
  // Once a book reaches the LLM enrichment stages its text is fully ingested,
  // so it stays openable (and the reader keeps working) during re-analysis;
  // the progress ring shrinks to a corner badge instead of a blocking overlay.
  const openable = isOpenableStatus(status);
  const enriching = live && openable;
  const failed = status === 'failed';

  const cover = (
    <div
      className={`relative aspect-[2/3] overflow-hidden rounded-[3px] bg-stone-900 shadow-[0_12px_28px_-12px_rgba(0,0,0,0.8)] ring-1 ring-white/10 transition-all duration-300 ${
        openable
          ? 'group-hover:-translate-y-1.5 group-hover:shadow-[0_22px_40px_-14px_rgba(224,155,59,0.25),0_18px_36px_-12px_rgba(0,0,0,0.9)] group-hover:ring-ember-400/40'
          : ''
      }`}
    >
      {showCoverImage ? (
        // Plain <img>: covers are private, per-user streamed objects, so
        // next/image's shared optimizer cache is the wrong tool here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/books/${book.id}/cover`}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setCoverFailed(true)}
        />
      ) : (
        <FallbackCover title={book.title} author={book.author} />
      )}
      <SpineOverlay />

      {live && !failed && !openable ? (
        // Pre-readable stages (uploading/ingesting/segmenting): the book has
        // nothing to open yet, so the full dimming overlay is honest.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-950/75 px-3 text-center backdrop-blur-[2px]">
          <ProgressRing percent={percent} size={60} />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ember-300">
              {STATUS_LABELS[status]}
            </p>
            {currentStep ? (
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-stone-400">
                {currentStep}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {enriching ? (
        // Enrichment stages (analyze/profile/imagine): the book is readable,
        // so progress lives in a non-blocking corner badge instead.
        <div
          className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-stone-950/80 py-1 pl-1.5 pr-2.5 backdrop-blur"
          title={`${STATUS_LABELS[status]}${currentStep ? ` — ${currentStep}` : ''}`}
        >
          <ProgressRing percent={null} size={16} />
          <span className="text-[10px] font-medium tabular-nums text-ember-300">
            {percent != null ? `${Math.round(percent)}%` : STATUS_LABELS[status]}
          </span>
        </div>
      ) : null}

      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-stone-950/85 px-3 text-center">
          <span className="rounded-full border border-red-400/40 bg-red-950/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">
            Failed
          </span>
          {error ? (
            <p className="line-clamp-3 text-[11px] leading-snug text-stone-400">{error}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Retry is coming soon"
              className="cursor-not-allowed rounded-full border border-stone-700 px-3 py-1 text-[11px] text-stone-500"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => onDeleteRequest(book)}
              className="rounded-full border border-red-400/40 px-3 py-1 text-[11px] text-red-300 transition hover:bg-red-950/60"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <article className="group relative animate-rise">
      {openable ? (
        <Link
          href={`/books/${book.id}`}
          aria-label={`Open “${book.title}”`}
          className="block rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ember-400/70 focus-visible:ring-offset-4 focus-visible:ring-offset-stone-950"
        >
          {cover}
        </Link>
      ) : (
        cover
      )}

      <div className="mt-3 pr-6">
        <h3 className="line-clamp-2 font-display text-[15px] leading-tight text-parchment">
          {book.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-stone-500">{book.author ?? '—'}</p>
        {openable && book.continueChapterIdx != null ? (
          <Link
            href={`/books/${book.id}/read`}
            className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-[11px] font-medium text-parchment/60 outline-none transition hover:text-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70"
          >
            Continue · Ch {book.continueChapterIdx + 1}
            <span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDeleteRequest(book)}
        aria-label={`Delete “${book.title}”`}
        title="Delete"
        className="absolute right-1.5 top-1.5 z-10 rounded-full border border-stone-700/80 bg-stone-950/80 p-1.5 text-stone-400 opacity-0 backdrop-blur transition hover:border-red-400/50 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </article>
  );
}

/** Optimistic placeholder shown while an EPUB is uploading. */
export function UploadingBookCard({ title }: { title: string }) {
  return (
    <article className="animate-rise">
      <div className="relative flex aspect-[2/3] flex-col items-center justify-center gap-3 overflow-hidden rounded-[3px] bg-stone-900 px-3 text-center ring-1 ring-white/10">
        <ProgressRing percent={null} size={60} />
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ember-300">
          Uploading
        </p>
        <SpineOverlay />
      </div>
      <div className="mt-3">
        <h3 className="line-clamp-2 font-display text-[15px] leading-tight text-parchment/70">
          {title}
        </h3>
        <p className="mt-1 text-xs text-stone-600">On its way to the shelf…</p>
      </div>
    </article>
  );
}
