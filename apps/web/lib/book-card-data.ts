import type { BookStatus, PipelineRunStatus } from '@vividpages/db';

/**
 * The slice of a book (plus its latest pipeline run) that the Bookcase UI
 * needs. Serializable, so a server component can pass it to client
 * components, and structural, so it accepts both Drizzle rows and the JSON
 * body of POST /api/books.
 */
export interface BookCardData {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  error: string | null;
  hasCover: boolean;
  /** 0-based chapter index of the saved reading position, or null. */
  continueChapterIdx: number | null;
  latestRun: {
    stage: string;
    status: PipelineRunStatus;
    percent: number;
    currentStep: string | null;
    error: string | null;
  } | null;
}

/** Minimal structural input for {@link toBookCardData}. */
export interface BookLike {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  error: string | null;
  coverObjectKey: string | null;
  progress?: { chapterIdx: number } | null;
  latestRun?: {
    stage: string;
    status: PipelineRunStatus;
    percent: number;
    currentStep: string | null;
    error: string | null;
  } | null;
}

export function toBookCardData(book: BookLike): BookCardData {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    status: book.status,
    error: book.error,
    hasCover: Boolean(book.coverObjectKey),
    continueChapterIdx: book.progress?.chapterIdx ?? null,
    latestRun: book.latestRun
      ? {
          stage: book.latestRun.stage,
          status: book.latestRun.status,
          percent: book.latestRun.percent,
          currentStep: book.latestRun.currentStep,
          error: book.latestRun.error,
        }
      : null,
  };
}

export function isTerminalStatus(status: BookStatus): boolean {
  return status === 'ready' || status === 'failed';
}

/**
 * True when the book's text is on the shelf and readable. By the time a book
 * reaches 'analyzing' its chapters and scenes are fully ingested, so the
 * LLM stages (analyze/profile/imagine) only ENRICH a book the user can
 * already read — re-analysis must not lock them out of it.
 */
export function isOpenableStatus(status: BookStatus): boolean {
  return (
    status === 'ready' ||
    status === 'analyzing' ||
    status === 'profiling' ||
    status === 'imagining'
  );
}

/** Friendly labels for in-flight statuses shown on the progress overlay. */
export const STATUS_LABELS: Record<BookStatus, string> = {
  uploading: 'Uploading',
  ingesting: 'Reading the book',
  segmenting: 'Finding the scenes',
  analyzing: 'Studying the characters',
  profiling: 'Sketching the cast',
  imagining: 'Painting the scenes',
  ready: 'Ready',
  failed: 'Failed',
};
