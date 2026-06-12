'use client';

import { useEffect, useRef } from 'react';

import { chapterLabel } from '@/lib/reader-types';

/**
 * Slide-over table of contents. The current chapter is highlighted and takes
 * initial focus so keyboard users land where they are; Escape and the
 * backdrop close it, and focus returns to the opener on unmount.
 */
export function ChapterPicker({
  chapters,
  currentIdx,
  onSelect,
  onClose,
}: {
  chapters: Array<{ idx: number; title: string | null }>;
  currentIdx: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = panelRef.current?.querySelector<HTMLButtonElement>('[data-current="true"]');
    (current ?? panelRef.current?.querySelector('button'))?.focus();
    current?.scrollIntoView({ block: 'center' });
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 animate-fade-in bg-black/45"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chapters"
        className="reader-pop absolute inset-y-0 right-0 flex w-80 max-w-[85vw] animate-slide-in flex-col"
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--reader-border)' }}
        >
          <h2 className="font-display text-lg tracking-tight">Contents</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chapter list"
            className="reader-btn h-8 w-8 rounded-full text-sm"
          >
            ✕
          </button>
        </div>

        <ol className="flex-1 overflow-y-auto px-2 py-3">
          {chapters.map((chapter) => {
            const isCurrent = chapter.idx === currentIdx;
            return (
              <li key={chapter.idx}>
                <button
                  type="button"
                  data-current={isCurrent || undefined}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => onSelect(chapter.idx)}
                  className="flex w-full items-baseline gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition"
                  style={
                    isCurrent
                      ? { backgroundColor: 'var(--reader-hover)', color: 'var(--reader-accent)' }
                      : undefined
                  }
                  onMouseEnter={(event) => {
                    if (!isCurrent)
                      event.currentTarget.style.backgroundColor = 'var(--reader-hover)';
                  }}
                  onMouseLeave={(event) => {
                    if (!isCurrent) event.currentTarget.style.backgroundColor = '';
                  }}
                >
                  <span
                    className="w-6 shrink-0 text-right font-display text-xs tabular-nums"
                    style={{ color: isCurrent ? 'var(--reader-accent)' : 'var(--reader-muted)' }}
                  >
                    {chapter.idx + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{chapterLabel(chapter)}</span>
                  {isCurrent ? (
                    <span aria-hidden className="text-xs">
                      ●
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
