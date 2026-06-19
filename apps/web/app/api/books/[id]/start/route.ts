import { getQueue } from '@vividpages/core/queues';
import { books, getDb, pipelineRuns, stylePresets } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { findOwnedBook } from '@/lib/find-owned-book';

type RouteContext = { params: Promise<{ id: string }> };

/** Wizard choices collected up front, persisted on Finish. */
const bodySchema = z.object({
  matureContent: z.boolean(),
  /** A built-in/owned style preset id, or null to use the default. */
  stylePresetId: z.string().uuid().nullable().default(null),
});

/**
 * POST /api/books/[id]/start — the upload wizard's Finish action.
 *
 * Persists the up-front choices (mature flag + style preset) and enqueues the
 * pipeline head (ingest). Ingest then auto-chains the WHOLE pipeline —
 * ingest → segment → analyze → profiles → imagine — to finished art with no
 * further clicks.
 *
 * Only valid for a freshly-uploaded book with no pipeline run yet (status
 * 'uploading'). A book that has already been started returns 409 so a
 * double-Finish (or a re-opened wizard) can't spawn a second head; the
 * partial unique index (one 'running' run per book) is the authoritative gate.
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
      { error: "Expected JSON body { matureContent: boolean, stylePresetId?: string | null }." },
      { status: 400 },
    );
  }
  const { matureContent, stylePresetId } = parsed.data;

  // The pipeline only starts from a not-yet-started book. Anything past
  // 'uploading' already has (or had) a run — re-running is the pipeline
  // route's job, not the wizard's.
  if (book.status !== 'uploading') {
    return NextResponse.json(
      { error: 'This book has already been started.' },
      { status: 409 },
    );
  }

  const db = getDb();

  // Validate the style preset (if any) belongs to a real preset before pinning
  // it, so imagine can't fail later on a dangling reference.
  if (stylePresetId) {
    const preset = await db.query.stylePresets.findFirst({
      where: eq(stylePresets.id, stylePresetId),
      columns: { id: true },
    });
    if (!preset) {
      return NextResponse.json({ error: 'Unknown style preset.' }, { status: 400 });
    }
  }

  // Persist choices + create the run + flip status to 'ingesting' atomically,
  // so a failure can't leave a book in a half-started state.
  let runId: string;
  try {
    ({ runId } = await db.transaction(async (tx) => {
      await tx
        .update(books)
        .set({
          matureContent,
          stylePresetId,
          status: 'ingesting',
          error: null,
        })
        .where(eq(books.id, book.id));

      const [run] = await tx
        .insert(pipelineRuns)
        .values({ bookId: book.id, stage: 'ingest', currentStep: 'Queued', status: 'running' })
        .returning({ id: pipelineRuns.id });
      if (!run) throw new Error('Pipeline run insert returned no row');

      return { runId: run.id };
    }));
  } catch (error) {
    // A racing Finish inserted its run first; the partial unique index
    // rejected ours and rolled the transaction back.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'This book has already been started.' },
        { status: 409 },
      );
    }
    throw error;
  }

  try {
    await getQueue('ingest').add('ingest', { bookId: book.id, runId });
  } catch (error) {
    // The book/run rows already exist; mark them failed (honest, visible,
    // deletable state) instead of leaving the book stuck at 'ingesting'.
    console.error(`start: failed to enqueue ingest job for book ${book.id}:`, error);
    const enqueueError = 'failed to enqueue ingest job';
    try {
      await db.update(books).set({ status: 'failed', error: enqueueError }).where(eq(books.id, book.id));
      await db
        .update(pipelineRuns)
        .set({ status: 'failed', error: enqueueError })
        .where(eq(pipelineRuns.id, runId));
    } catch (bookkeepingError) {
      console.error(`start: failed to mark book ${book.id} as failed:`, bookkeepingError);
    }
    return NextResponse.json({ error: 'Failed to enqueue ingest job.' }, { status: 500 });
  }

  return NextResponse.json({ runId }, { status: 202 });
}
