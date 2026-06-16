import { CharacterMergeError, mergeCharacters } from '@vividpages/core/characters/merge';
import { getQueue } from '@vividpages/core/queues';
import { books, characters, getDb, pipelineRuns } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { findOwnedBook } from '@/lib/find-owned-book';
import { getLatestRun, isActiveRun } from '@/lib/queries';

type RouteContext = { params: Promise<{ id: string }> };

const mergeSchema = z
  .object({
    keepId: z.string().uuid(),
    absorbId: z.string().uuid(),
  })
  .refine((b) => b.keepId !== b.absorbId, {
    message: 'keepId and absorbId must be different characters.',
  });

/**
 * POST /api/books/[id]/characters/merge — combine two duplicate characters.
 *
 * Absorbs `absorbId` into the surviving primary `keepId` (the primary keeps its
 * profile / portrait / appearanceToken / role / LoRA / embedding; the absorbed
 * row contributes its scene appearances + name as an alias, then is deleted).
 * The data merge is transactional in core. Afterwards we **fence** an auto-regen
 * of the affected scene storyboards behind the one-running-run-per-book index:
 * if a run is already active (or the enqueue fails) the merge still succeeds and
 * we return `regenerating: 0` with a note to regenerate manually.
 *
 * Returns `{ character: <keeper>, regenerating, note? }`.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { id: bookId } = await params;
  const book = await findOwnedBook(bookId, userId);
  if (!book) {
    return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid merge request.' },
      { status: 400 },
    );
  }
  const { keepId, absorbId } = parsed.data;

  const db = getDb();

  // 1) The data merge (transactional in core). Ownership is re-checked there via
  //    the bookId scope: a character in another book reads as NOT_FOUND.
  let affectedPointIds: string[];
  try {
    ({ affectedPointIds } = await mergeCharacters(db, { keepId, absorbId, bookId }));
  } catch (error) {
    if (error instanceof CharacterMergeError) {
      const status = error.code === 'SAME_ID' ? 400 : 404;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }

  const keeper = await db.query.characters.findFirst({
    where: and(eq(characters.id, keepId), eq(characters.bookId, bookId)),
  });
  if (!keeper) {
    // Should be impossible — the keeper is what mergeCharacters preserves.
    return NextResponse.json({ error: 'Merged character not found.' }, { status: 500 });
  }

  // 2) Fenced auto-regen of the affected scene storyboards. Best-effort: if there
  //    is nothing to repaint, or a run is already in progress, the merge still
  //    succeeds and the user can regenerate manually.
  const manualNote = 'a run is in progress; regenerate manually';

  if (affectedPointIds.length === 0) {
    return NextResponse.json({ character: keeper, regenerating: 0 });
  }

  if (isActiveRun(await getLatestRun(bookId))) {
    return NextResponse.json({ character: keeper, regenerating: 0, note: manualNote });
  }

  let runId: string;
  try {
    ({ runId } = await db.transaction(async (tx) => {
      // A stale 'running' row (crashed worker) may still exist; supersede it so
      // the partial unique index admits the new run.
      await tx
        .update(pipelineRuns)
        .set({ status: 'failed', error: 'superseded' })
        .where(and(eq(pipelineRuns.bookId, bookId), eq(pipelineRuns.status, 'running')));

      const [run] = await tx
        .insert(pipelineRuns)
        .values({
          bookId,
          stage: 'imagine',
          currentStep: 'Queued',
          status: 'running',
        })
        .returning({ id: pipelineRuns.id });
      if (!run) throw new Error('Pipeline run insert returned no row');

      await tx.update(books).set({ status: 'imagining', error: null }).where(eq(books.id, bookId));

      return { runId: run.id };
    }));
  } catch (error) {
    // A racing request won the partial unique index: the merge already
    // committed, so report success but skip auto-regen.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ character: keeper, regenerating: 0, note: manualNote });
    }
    throw error;
  }

  try {
    await getQueue('imagine').add('imagine', {
      bookId,
      runId,
      only: { kind: 'scene_storyboard', subjectIds: affectedPointIds },
    });
  } catch (error) {
    console.error(
      `merge: failed to enqueue imagine regen for book ${bookId}:`,
      error,
    );
    const enqueueError = 'failed to enqueue imagine regen job';
    try {
      // The merge committed and the book is fully usable; only the auto-regen
      // didn't start. Return the book to 'ready' (not 'failed') and mark just
      // the orphaned run failed so it doesn't linger 'running' behind the fence.
      await db
        .update(books)
        .set({ status: 'ready', error: null })
        .where(eq(books.id, bookId));
      await db
        .update(pipelineRuns)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(pipelineRuns.id, runId));
    } catch (bookkeepingError) {
      console.error(`merge: failed to reset book ${bookId} status after enqueue failure:`, bookkeepingError);
    }
    // The merge itself succeeded; surface that with a manual-regen note.
    return NextResponse.json({ character: keeper, regenerating: 0, note: manualNote });
  }

  return NextResponse.json({ character: keeper, regenerating: affectedPointIds.length });
}
