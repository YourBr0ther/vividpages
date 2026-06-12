'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { chapterLabel, type ChapterPayload } from '@/lib/reader-types';

import { ChapterPicker } from './chapter-picker';
import {
  READER_FONT_SIZES,
  READER_THEMES,
  ReaderControls,
  type ReaderFontSize,
  type ReaderTheme,
} from './reader-controls';
import { SceneBlock } from './scene-block';

const THEME_STORAGE_KEY = 'vividpages.reader.theme';
const SIZE_STORAGE_KEY = 'vividpages.reader.size';

/** M5 flips this on to show empty illustration panels between scenes. */
const SHOW_IMAGE_SLOTS = false;

/** Debounce for persisting the reading position. */
const SAVE_DELAY_MS = 2000;

interface ChapterRef {
  idx: number;
  title: string | null;
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" strokeLinecap="round" />
      <path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

/**
 * The Reader: a fullscreen reading surface layered over the app shell with
 * its own theme system. Receives the first chapter server-rendered; fetches
 * and caches further chapters on demand, keeps ?chapter= in sync, tracks the
 * topmost visible scene, and debounce-saves the reading position.
 */
export function Reader({
  bookId,
  bookTitle,
  chapters,
  initialChapter,
  initialSceneGlobalIdx,
}: {
  bookId: string;
  bookTitle: string;
  chapters: ChapterRef[];
  initialChapter: ChapterPayload;
  initialSceneGlobalIdx: number | null;
}) {
  const pathname = usePathname();

  const [chapter, setChapter] = useState(initialChapter);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<number | null>(null);
  const [theme, setTheme] = useState<ReaderTheme>('dark');
  const [size, setSize] = useState<ReaderFontSize>('m');
  const [chromeHidden, setChromeHidden] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const chapterCache = useRef<Map<number, ChapterPayload>>(new Map());
  const chapterIdxRef = useRef(initialChapter.idx);
  const sceneIdxRef = useRef(initialSceneGlobalIdx ?? initialChapter.scenes[0]?.globalIdx ?? 0);
  /** Scene to scroll to once the initial chapter has painted (saved position). */
  const restoreSceneRef = useRef(initialSceneGlobalIdx);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savePendingRef = useRef(false);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    chapterIdxRef.current = chapter.idx;
  }, [chapter.idx]);

  useEffect(() => {
    chapterCache.current.set(initialChapter.idx, initialChapter);
  }, [initialChapter]);

  // ---- Preferences (theme + font size), persisted to localStorage --------

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ReaderTheme | null;
      if (storedTheme && READER_THEMES.includes(storedTheme)) setTheme(storedTheme);
      const storedSize = localStorage.getItem(SIZE_STORAGE_KEY) as ReaderFontSize | null;
      if (storedSize && READER_FONT_SIZES.includes(storedSize)) setSize(storedSize);
    } catch {
      // Private mode / blocked storage: keep defaults.
    }
  }, []);

  const changeTheme = useCallback((next: ReaderTheme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
  }, []);

  const changeSize = useCallback((next: ReaderFontSize) => {
    setSize(next);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, next);
    } catch {}
  }, []);

  // ---- Reading-position persistence (debounced PUT) -----------------------

  const putProgress = useCallback(() => {
    savePendingRef.current = false;
    void fetch(`/api/books/${bookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterIdx: chapterIdxRef.current,
        sceneGlobalIdx: sceneIdxRef.current,
      }),
      keepalive: true,
    }).catch(() => {
      // Losing one position write is harmless; the next scroll retries.
    });
  }, [bookId]);

  const scheduleSave = useCallback(() => {
    savePendingRef.current = true;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(putProgress, SAVE_DELAY_MS);
  }, [putProgress]);

  // Flush a pending save when the Reader unmounts (back to detail page, etc.).
  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current);
      if (savePendingRef.current) putProgress();
    },
    [putProgress],
  );

  // ---- Chapter navigation --------------------------------------------------

  const showChapter = useCallback(
    (payload: ChapterPayload) => {
      setChapter(payload);
      setLoading(false);
      setLoadError(null);
      sceneIdxRef.current = payload.scenes[0]?.globalIdx ?? 0;
      scheduleSave();
    },
    [scheduleSave],
  );

  const navigateTo = useCallback(
    async (idx: number) => {
      setPickerOpen(false);
      if (idx === chapterIdxRef.current || !chapters.some((c) => c.idx === idx)) return;
      restoreSceneRef.current = null;
      // Shallow URL sync (Next.js tracks native replaceState): no scroll
      // jank, no server round-trip for a chapter we fetch/cached ourselves.
      window.history.replaceState(null, '', `${pathname}?chapter=${idx}`);

      const cached = chapterCache.current.get(idx);
      if (cached) {
        showChapter(cached);
        return;
      }

      setLoading(true);
      setLoadError(null);
      const seq = ++fetchSeqRef.current;
      try {
        const res = await fetch(`/api/books/${bookId}/content?chapter=${idx}`);
        if (!res.ok) throw new Error(`content fetch failed: ${res.status}`);
        const data = (await res.json()) as { chapter: ChapterPayload };
        chapterCache.current.set(idx, data.chapter);
        if (seq === fetchSeqRef.current) showChapter(data.chapter);
      } catch {
        if (seq === fetchSeqRef.current) {
          setLoading(false);
          setLoadError(idx);
        }
      }
    },
    [bookId, chapters, pathname, showChapter],
  );

  const position = chapters.findIndex((c) => c.idx === chapter.idx);
  const prevChapter = position > 0 ? chapters[position - 1] : undefined;
  const nextChapter = position >= 0 ? chapters[position + 1] : undefined;

  // Keyboard: ← / → step between chapters (unless a dialog/input is in play).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (pickerOpen) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      if (event.key === 'ArrowRight' && nextChapter) {
        event.preventDefault();
        void navigateTo(nextChapter.idx);
      } else if (event.key === 'ArrowLeft' && prevChapter) {
        event.preventDefault();
        void navigateTo(prevChapter.idx);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigateTo, nextChapter, prevChapter, pickerOpen]);

  // ---- Scroll position: restore saved scene, else top of new chapter ------

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const target = restoreSceneRef.current;
    if (chapter.idx === initialChapter.idx && target != null) {
      // Instant (smooth-less) jump to the saved scene; scroll-mt on the
      // section keeps it clear of the top bar.
      surface
        .querySelector(`[data-scene="${target}"]`)
        ?.scrollIntoView({ behavior: 'instant', block: 'start' });
      return;
    }
    surface.scrollTop = 0;
  }, [chapter.idx, initialChapter.idx]);

  // Focus the surface so PageDown/space/↑↓ scroll it without a click first.
  useEffect(() => {
    surfaceRef.current?.focus({ preventScroll: true });
  }, []);

  // ---- Topmost-visible-scene tracking (IntersectionObserver) --------------

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.scene);
          if (Number.isNaN(idx)) continue;
          if (entry.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        }
        if (visible.size === 0) return;
        // Scenes overlapping the top 45% of the viewport; the earliest one is
        // the scene the reader is "at".
        const topmost = Math.min(...visible);
        if (topmost !== sceneIdxRef.current) {
          sceneIdxRef.current = topmost;
          scheduleSave();
        }
      },
      { root: surface, rootMargin: '0px 0px -55% 0px' },
    );
    surface.querySelectorAll('[data-scene]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [chapter, scheduleSave]);

  // ---- Scroll-driven chrome + chapter progress bar -------------------------

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let lastTop = surface.scrollTop;
    let frame = 0;

    function update() {
      frame = 0;
      const top = surface!.scrollTop;
      const max = surface!.scrollHeight - surface!.clientHeight;
      if (progressBarRef.current) {
        const fraction = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;
        progressBarRef.current.style.transform = `scaleX(${fraction})`;
      }
      const delta = top - lastTop;
      if (top < 96) setChromeHidden(false);
      else if (delta > 6) setChromeHidden(true);
      else if (delta < -6) setChromeHidden(false);
      lastTop = top;
    }

    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    function onMouseMove() {
      setChromeHidden(false);
    }

    surface.addEventListener('scroll', onScroll, { passive: true });
    surface.addEventListener('mousemove', onMouseMove, { passive: true });
    update();
    return () => {
      surface.removeEventListener('scroll', onScroll);
      surface.removeEventListener('mousemove', onMouseMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chapter.idx]);

  // ---- Scene paragraphs ----------------------------------------------------

  const sceneBlocks = useMemo(
    () =>
      chapter.scenes.map((scene, i) => ({
        globalIdx: scene.globalIdx,
        isFirst: i === 0,
        paragraphs: chapter.text
          .slice(scene.startOffset, scene.endOffset)
          .split('\n\n')
          .map((paragraph) => paragraph.trim())
          .filter(Boolean),
      })),
    [chapter],
  );

  const title = chapterLabel(chapter);

  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      data-reader-theme={theme}
      data-reader-size={size}
      className="reader-surface fixed inset-0 z-50 overflow-y-auto overscroll-contain outline-none"
    >
      <a
        href="#reader-text"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ember-400 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-stone-950"
      >
        Skip to text
      </a>

      {/* Chapter progress (scroll-driven; width via transform, no re-render). */}
      <div
        ref={progressBarRef}
        aria-hidden
        className="reader-progressbar fixed left-0 top-0 z-30 h-0.5 w-full origin-left"
        style={{ backgroundColor: 'var(--reader-accent)', transform: 'scaleX(0)', opacity: 0.8 }}
      />

      <header className="reader-chrome sticky top-0 z-20" data-hidden={chromeHidden}>
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <Link
            href={`/books/${bookId}`}
            aria-label="Back to book"
            title="Back to book"
            className="reader-btn h-9 w-9 shrink-0 rounded-full text-base"
          >
            ←
          </Link>
          <p className="min-w-0 flex-1 truncate text-center text-sm">
            <span className="font-display">{bookTitle}</span>
            <span style={{ color: 'var(--reader-muted)' }}> · {title}</span>
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Chapters"
            title="Chapters"
            className="reader-btn h-9 w-9 shrink-0 rounded-full"
          >
            <ListIcon className="h-4 w-4" />
          </button>
          <ReaderControls
            theme={theme}
            size={size}
            onThemeChange={changeTheme}
            onSizeChange={changeSize}
          />
        </div>
      </header>

      <main
        id="reader-text"
        tabIndex={-1}
        className="mx-auto w-full max-w-prose px-5 pb-28 pt-10 outline-none sm:pt-16"
      >
        <article aria-label={title} className={loading ? 'opacity-50 transition-opacity' : ''}>
          <header className="mb-12 text-center">
            {/* Ordinal position, not "Chapter N": many books carry their own
                chapter numbering (plus prologues etc.) in the titles. */}
            <p
              className="font-sans text-[11px] font-medium uppercase tracking-[0.35em]"
              style={{ color: 'var(--reader-accent)' }}
            >
              {position + 1} of {chapters.length}
            </p>
            <h1 className="mt-3 text-balance font-display text-3xl tracking-tight sm:text-4xl">
              {title}
            </h1>
            <div
              aria-hidden
              className="mx-auto mt-7 h-px w-16"
              style={{ backgroundColor: 'var(--reader-border)' }}
            />
          </header>

          <div className="reader-prose">
            {sceneBlocks.map((scene) => (
              <SceneBlock
                key={scene.globalIdx}
                globalIdx={scene.globalIdx}
                paragraphs={scene.paragraphs}
                isFirstInChapter={scene.isFirst}
                showImageSlot={SHOW_IMAGE_SLOTS}
              />
            ))}
          </div>

          <nav
            aria-label="Chapter navigation"
            className="mt-16 flex items-stretch justify-between gap-4 border-t pt-8 font-sans"
            style={{ borderColor: 'var(--reader-border)' }}
          >
            {prevChapter ? (
              <button
                type="button"
                onClick={() => void navigateTo(prevChapter.idx)}
                className="reader-btn max-w-[46%] flex-col items-start rounded-xl px-5 py-3 text-left"
              >
                <span
                  className="text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: 'var(--reader-muted)' }}
                >
                  ← Previous
                </span>
                <span className="mt-1 line-clamp-1 font-display text-sm">
                  {chapterLabel(prevChapter)}
                </span>
              </button>
            ) : (
              <span aria-hidden />
            )}
            {nextChapter ? (
              <button
                type="button"
                onClick={() => void navigateTo(nextChapter.idx)}
                className="reader-btn max-w-[46%] flex-col items-end rounded-xl px-5 py-3 text-right"
              >
                <span
                  className="text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: 'var(--reader-muted)' }}
                >
                  Next →
                </span>
                <span className="mt-1 line-clamp-1 font-display text-sm">
                  {chapterLabel(nextChapter)}
                </span>
              </button>
            ) : (
              <span
                className="self-center font-display text-sm italic"
                style={{ color: 'var(--reader-muted)' }}
              >
                The End
              </span>
            )}
          </nav>
        </article>
      </main>

      {loadError != null ? (
        <div
          role="alert"
          className="reader-pop fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full px-5 py-2.5 font-sans text-sm"
        >
          Couldn&rsquo;t load that chapter.
          <button
            type="button"
            onClick={() => void navigateTo(loadError)}
            className="font-semibold underline underline-offset-2"
            style={{ color: 'var(--reader-accent)' }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {pickerOpen ? (
        <ChapterPicker
          chapters={chapters}
          currentIdx={chapter.idx}
          onSelect={(idx) => void navigateTo(idx)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
