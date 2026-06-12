import { books, getDb, pipelineRuns, type BookStatus } from '@vividpages/db';
import { eq } from 'drizzle-orm';

/**
 * Progress bookkeeping for pipeline stages. All helpers write to Postgres;
 * `updatedAt` is bumped automatically via the schema's `$onUpdate`.
 */

export interface ProgressUpdate {
  stage: string;
  /** Clamped to [0, 100]. */
  percent: number;
  currentStep?: string;
}

export async function reportProgress(runId: string, update: ProgressUpdate): Promise<void> {
  const percent = Math.min(100, Math.max(0, update.percent));
  // Status is forced back to 'running' and error cleared on every call so a
  // run that failed and is being retried (BullMQ re-attempt) doesn't stay
  // stuck at 'failed' with a stale error while it is actually progressing.
  await getDb()
    .update(pipelineRuns)
    .set({
      stage: update.stage,
      percent,
      currentStep: update.currentStep,
      status: 'running',
      error: null,
    })
    .where(eq(pipelineRuns.id, runId));
}

export async function completeRun(runId: string): Promise<void> {
  await getDb()
    .update(pipelineRuns)
    .set({ status: 'done', percent: 100, error: null })
    .where(eq(pipelineRuns.id, runId));
}

export async function failRun(runId: string, error: string): Promise<void> {
  await getDb()
    .update(pipelineRuns)
    .set({ status: 'failed', error })
    .where(eq(pipelineRuns.id, runId));
}

/**
 * Sets the book's pipeline status. `error` is cleared unless provided, so a
 * retried stage that reaches setBookStatus('ingesting') wipes the stale
 * failure message from the previous attempt.
 */
export async function setBookStatus(
  bookId: string,
  status: BookStatus,
  error?: string,
): Promise<void> {
  await getDb()
    .update(books)
    .set({ status, error: error ?? null })
    .where(eq(books.id, bookId));
}
