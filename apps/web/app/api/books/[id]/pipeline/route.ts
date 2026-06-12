import { getQueue } from '@vividpages/core/queues';
import { books, characters, getDb, pipelineRuns, scenes } from '@vividpages/db';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { findOwnedBook } from '@/lib/find-owned-book';
import { getLatestRun, isActiveRun } from '@/lib/queries';

const bodySchema = z.object({
  action: z.enum(['analyze', 'profiles', 'imagine']),
  force: z.boolean().optional().default(false),
});

/** Book status / pipeline stage per action while the run is queued. */
const ACTION_STAGE = {
  analyze: { status: 'analyzing', stage: 'analyze' },
  profiles: { status: 'profiling', stage: 'profiles' },
  imagine: { status: 'imagining', stage: 'imagine' },
} as const;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/books/[id]/pipeline — start a pipeline run for an owned book.
 *
 * Body: `{ action: 'analyze' | 'profiles' | 'imagine', force?: boolean }`.
 *
 * - `analyze`: re-enters the pipeline at scene analysis (which chains into
 *   profiles when it finishes). Resume-style by default — scenes already
 *   'done' are skipped. With `force`, every scene is reset to 'pending' and
 *   the book's characters are deleted first: a full cast rebuild.
 * - `profiles`: re-runs only the profiles stage (dedup + visual profiles);
 *   `force` recomputes characters that are already profiled.
 * - `imagine`: generates art — character portraits + scene storyboards.
 *   Resume-style: subjects that already have a finished image are skipped.
 *
 * Returns 202 `{ runId }`, or 409 when a run is already active. "Active"
 * means the latest run is 'running' AND wrote progress within the last 10
 * minutes — a stuck 'running' row older than that (crashed worker) is
 * treated as stale: it is marked failed ('superseded') and the user can
 * start over.
 *
 * Concurrency: the isActiveRun() pre-check is a friendly fast path only. The
 * authoritative gate is the `pipeline_runs_book_running_unique` partial
 * unique index (one 'running' run per book) — a racing duplicate insert
 * fails with a unique violation, which is mapped to the same 409.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = await params;
  const book = await findOwnedBook(id, userId);
  if (!book) {
    return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected JSON body { action: 'analyze' | 'profiles', force?: boolean }." },
      { status: 400 },
    );
  }
  const { action, force } = parsed.data;

  if (isActiveRun(await getLatestRun(book.id))) {
    return NextResponse.json(
      { error: 'A pipeline run is already in progress for this book.' },
      { status: 409 },
    );
  }

  const db = getDb();

  // The stages assume earlier pipeline output exists; fail loudly up front
  // instead of enqueueing a job that can only crash.
  if (action === 'analyze') {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scenes)
      .where(eq(scenes.bookId, book.id));
    if ((row?.count ?? 0) === 0) {
      return NextResponse.json(
        { error: 'The book has no scenes yet — ingestion must finish first.' },
        { status: 409 },
      );
    }
  } else if (action === 'profiles') {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(characters)
      .where(eq(characters.bookId, book.id));
    if ((row?.count ?? 0) === 0) {
      return NextResponse.json(
        { error: 'No characters to profile yet — run analysis first.' },
        { status: 409 },
      );
    }
  } else {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scenes)
      .where(and(eq(scenes.bookId, book.id), eq(scenes.analysisStatus, 'done')));
    if ((row?.count ?? 0) === 0) {
      return NextResponse.json(
        { error: 'No analyzed scenes to illustrate yet — run analysis first.' },
        { status: 409 },
      );
    }
  }

  // Run row, book status, stale-run supersede, and any force-reset happen
  // atomically so a failure can't leave a half-reset book or a status with
  // no run behind it.
  let runId: string;
  try {
    ({ runId } = await db.transaction(async (tx) => {
      // The pre-check above decided no run is ACTIVE, but a stale 'running'
      // row (crashed worker / evaporated job) may still exist; mark it
      // failed so the partial unique index admits the new run and the runs
      // history reads honestly.
      await tx
        .update(pipelineRuns)
        .set({ status: 'failed', error: 'superseded' })
        .where(and(eq(pipelineRuns.bookId, book.id), eq(pipelineRuns.status, 'running')));

      if (action === 'analyze' && force) {
        // Full cast rebuild: every scene gets re-analyzed and the character
        // table is rebuilt from scratch (scene_characters cascade-deletes).
        await tx
          .update(scenes)
          .set({ analysisStatus: 'pending' })
          .where(eq(scenes.bookId, book.id));
        await tx.delete(characters).where(eq(characters.bookId, book.id));
      }

      const [run] = await tx
        .insert(pipelineRuns)
        .values({
          bookId: book.id,
          stage: ACTION_STAGE[action].stage,
          currentStep: 'Queued',
          status: 'running',
        })
        .returning({ id: pipelineRuns.id });
      if (!run) throw new Error('Pipeline run insert returned no row');

      await tx
        .update(books)
        .set({ status: ACTION_STAGE[action].status, error: null })
        .where(eq(books.id, book.id));

      return { runId: run.id };
    }));
  } catch (error) {
    // Authoritative concurrency gate: a racing request inserted its run
    // first, so the partial unique index rejected ours. The transaction
    // rolled back (including any force-reset), so nothing was disturbed.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'A pipeline run is already in progress for this book.' },
        { status: 409 },
      );
    }
    throw error;
  }

  try {
    if (action === 'analyze') {
      await getQueue('analyze').add('analyze', { bookId: book.id, runId });
    } else if (action === 'profiles') {
      await getQueue('profiles').add('profiles', { bookId: book.id, runId, force });
    } else {
      await getQueue('imagine').add('imagine', { bookId: book.id, runId });
    }
  } catch (error) {
    // Same honest-failure bookkeeping as the upload route: never leave the
    // book stuck in a running status with no job behind it.
    console.error(`pipeline: failed to enqueue ${action} job for book ${book.id}:`, error);
    const enqueueError = `failed to enqueue ${action} job`;
    try {
      await db
        .update(books)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(books.id, book.id));
      await db
        .update(pipelineRuns)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(pipelineRuns.id, runId));
    } catch (bookkeepingError) {
      console.error(`pipeline: failed to mark book ${book.id} as failed:`, bookkeepingError);
    }
    return NextResponse.json({ error: `Failed to enqueue ${action} job.` }, { status: 500 });
  }

  return NextResponse.json({ runId }, { status: 202 });
}
