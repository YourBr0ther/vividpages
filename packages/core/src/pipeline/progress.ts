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
  await getDb()
    .update(pipelineRuns)
    .set({ stage: update.stage, percent, currentStep: update.currentStep })
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
