import type { BookStatus, PipelineRunStatus } from '@vividpages/db';

/**
 * Payload of each SSE `data:` event from GET /api/books/[id]/events, and the
 * shape consumed by the useBookProgress hook. Run fields are null when the
 * book has no pipeline run yet.
 */
export interface BookProgressEvent {
  bookId: string;
  /** Book lifecycle status (uploading → … → ready | failed). */
  status: BookStatus;
  /** Latest pipeline run's status, or null when no run exists. */
  runStatus: PipelineRunStatus | null;
  stage: string | null;
  percent: number | null;
  currentStep: string | null;
  error: string | null;
}
