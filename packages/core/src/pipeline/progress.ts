import { books, getDb, pipelineRuns, type BookStatus } from '@vividpages/db';
import { desc, eq, sql } from 'drizzle-orm';

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

/** Atomically adds LLM token usage onto a run's running totals. */
export async function incrementRunTokens(
  runId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  if (tokensIn === 0 && tokensOut === 0) return;
  await getDb()
    .update(pipelineRuns)
    .set({
      tokensIn: sql`${pipelineRuns.tokensIn} + ${tokensIn}`,
      tokensOut: sql`${pipelineRuns.tokensOut} + ${tokensOut}`,
    })
    .where(eq(pipelineRuns.id, runId));
}

/**
 * True when `runId` is no longer the book's latest pipeline run — i.e. a
 * newer run was started while this job sat in the queue (or was retrying).
 * Stages MUST check this after loading the book and before any destructive
 * write (and before reportProgress, which would flip a superseded run back to
 * 'running' and trip the one-running-run-per-book unique index).
 */
export async function isRunSuperseded(bookId: string, runId: string): Promise<boolean> {
  const [latest] = await getDb()
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.bookId, bookId))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return latest !== undefined && latest.id !== runId;
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
