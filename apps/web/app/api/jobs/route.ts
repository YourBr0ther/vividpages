import { getQueue } from '@vividpages/core/queues';
import { books, getDb, pipelineRuns } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { findOwnedBook, UUID_RE } from '@/lib/find-owned-book';
import { getJobsData, getLatestRun, isActiveRun } from '@/lib/queries';

// Always reflects live DB state; never cache the jobs snapshot.
export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs — the same cross-book snapshot the dashboard server component
 * renders (recent runs + failed images + token totals), for the client to
 * poll every few seconds while a run is active. Auth + ownership are implicit:
 * getJobsData scopes everything to the session user's books.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return NextResponse.json(await getJobsData(userId));
}

const bodySchema = z.object({ runId: z.string() });

/** Pipeline stage → book status + queue name for a retry re-enqueue. */
const STAGE_REENQUEUE = {
  analyze: { status: 'analyzing', queue: 'analyze' },
  profiles: { status: 'profiling', queue: 'profiles' },
  imagine: { status: 'imagining', queue: 'imagine' },
} as const;

type RetryableStage = keyof typeof STAGE_REENQUEUE;

function isRetryableStage(stage: string): stage is RetryableStage {
  return stage === 'analyze' || stage === 'profiles' || stage === 'imagine';
}

/**
 * POST /api/jobs — retry a failed pipeline run.
 *
 * Body: `{ runId }`. Only failed runs of a re-enqueueable stage
 * (analyze/profiles/imagine) can be retried — the ingest/segment stages run
 * at upload time and have no standalone re-entry. Mirrors the pipeline
 * route's hardened shape: friendly isActiveRun pre-check, then an atomic
 * supersede-stale + insert-run + set-book-status transaction whose
 * authoritative gate is the one-running-run-per-book partial unique index
 * (unique violation → 409), and enqueue-failure compensation.
 *
 * Returns 202 `{ runId }` (the NEW run), 404 if the run isn't on one of the
 * user's books, 409 if a run is already active or the stage isn't retryable,
 * 422 if the run isn't failed.
 *
 * Failed IMAGES are retried via POST /api/images/[imageId]/regenerate, not
 * this route.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !UUID_RE.test(parsed.data.runId)) {
    return NextResponse.json({ error: 'Expected JSON body { runId }.' }, { status: 400 });
  }
  const { runId } = parsed.data;

  const db = getDb();
  const run = await db.query.pipelineRuns.findFirst({ where: eq(pipelineRuns.id, runId) });
  if (!run) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }
  // Ownership: the run must belong to one of the user's books.
  const book = await findOwnedBook(run.bookId, userId);
  if (!book) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  if (run.status !== 'failed') {
    return NextResponse.json(
      { error: 'Only failed runs can be retried.' },
      { status: 422 },
    );
  }
  if (!isRetryableStage(run.stage)) {
    return NextResponse.json(
      { error: `The ${run.stage} stage cannot be retried on its own.` },
      { status: 409 },
    );
  }
  const stage = run.stage;

  if (isActiveRun(await getLatestRun(book.id))) {
    return NextResponse.json(
      { error: 'A pipeline run is already in progress for this book.' },
      { status: 409 },
    );
  }

  let newRunId: string;
  try {
    ({ newRunId } = await db.transaction(async (tx) => {
      // Supersede any stale 'running' row so the partial unique index admits ours.
      await tx
        .update(pipelineRuns)
        .set({ status: 'failed', error: 'superseded' })
        .where(and(eq(pipelineRuns.bookId, book.id), eq(pipelineRuns.status, 'running')));

      const [inserted] = await tx
        .insert(pipelineRuns)
        .values({ bookId: book.id, stage, currentStep: 'Queued', status: 'running' })
        .returning({ id: pipelineRuns.id });
      if (!inserted) throw new Error('Pipeline run insert returned no row');

      await tx
        .update(books)
        .set({ status: STAGE_REENQUEUE[stage].status, error: null })
        .where(eq(books.id, book.id));

      return { newRunId: inserted.id };
    }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'A pipeline run is already in progress for this book.' },
        { status: 409 },
      );
    }
    throw error;
  }

  try {
    await getQueue(STAGE_REENQUEUE[stage].queue).add(stage, {
      bookId: book.id,
      runId: newRunId,
    });
  } catch (error) {
    console.error(`jobs: failed to enqueue ${stage} retry for book ${book.id}:`, error);
    const enqueueError = `failed to enqueue ${stage} job`;
    try {
      await db
        .update(books)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(books.id, book.id));
      await db
        .update(pipelineRuns)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(pipelineRuns.id, newRunId));
    } catch (bookkeepingError) {
      console.error(`jobs: failed to mark book ${book.id} as failed:`, bookkeepingError);
    }
    return NextResponse.json({ error: `Failed to enqueue ${stage} job.` }, { status: 500 });
  }

  return NextResponse.json({ runId: newRunId }, { status: 202 });
}
