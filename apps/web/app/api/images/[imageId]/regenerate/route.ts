import { getQueue } from '@vividpages/core/queues';
import { books, getDb, pipelineRuns } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { findOwnedImage } from '@/lib/find-owned-image';
import { getLatestRun, isActiveRun } from '@/lib/queries';

type RouteContext = { params: Promise<{ imageId: string }> };

/**
 * POST /api/images/[imageId]/regenerate — repaint ONE subject (the portrait
 * or storyboard this image belongs to) at the next version.
 *
 * Same hardened shape as the pipeline route: friendly isActiveRun pre-check,
 * atomic run-row + book-status transaction whose authoritative gate is the
 * one-running-run-per-book partial unique index (unique violation → 409),
 * and enqueue-failure compensation so the book is never left 'imagining'
 * with no job behind it. Returns 202 `{ runId }`.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { imageId } = await params;
  const owned = await findOwnedImage(imageId, userId);
  if (!owned) {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }
  const { image } = owned;

  if (
    !image.subjectId ||
    (image.kind !== 'character_portrait' && image.kind !== 'scene_storyboard')
  ) {
    return NextResponse.json({ error: 'This image cannot be regenerated.' }, { status: 400 });
  }
  const only = { kind: image.kind, subjectId: image.subjectId };

  if (isActiveRun(await getLatestRun(image.bookId))) {
    return NextResponse.json(
      { error: 'A pipeline run is already in progress for this book.' },
      { status: 409 },
    );
  }

  const db = getDb();

  let runId: string;
  try {
    ({ runId } = await db.transaction(async (tx) => {
      // A stale 'running' row (crashed worker) may still exist; supersede it
      // so the partial unique index admits the new run.
      await tx
        .update(pipelineRuns)
        .set({ status: 'failed', error: 'superseded' })
        .where(and(eq(pipelineRuns.bookId, image.bookId), eq(pipelineRuns.status, 'running')));

      const [run] = await tx
        .insert(pipelineRuns)
        .values({
          bookId: image.bookId,
          stage: 'imagine',
          currentStep: 'Queued',
          status: 'running',
        })
        .returning({ id: pipelineRuns.id });
      if (!run) throw new Error('Pipeline run insert returned no row');

      await tx
        .update(books)
        .set({ status: 'imagining', error: null })
        .where(eq(books.id, image.bookId));

      return { runId: run.id };
    }));
  } catch (error) {
    // Authoritative concurrency gate: a racing request won the partial
    // unique index; our transaction rolled back untouched.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'A pipeline run is already in progress for this book.' },
        { status: 409 },
      );
    }
    throw error;
  }

  try {
    await getQueue('imagine').add('imagine', { bookId: image.bookId, runId, only });
  } catch (error) {
    console.error(
      `regenerate: failed to enqueue imagine job for image ${image.id}:`,
      error,
    );
    const enqueueError = 'failed to enqueue imagine job';
    try {
      await db
        .update(books)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(books.id, image.bookId));
      await db
        .update(pipelineRuns)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(pipelineRuns.id, runId));
    } catch (bookkeepingError) {
      console.error(
        `regenerate: failed to mark book ${image.bookId} as failed:`,
        bookkeepingError,
      );
    }
    return NextResponse.json({ error: 'Failed to enqueue imagine job.' }, { status: 500 });
  }

  return NextResponse.json({ runId }, { status: 202 });
}
