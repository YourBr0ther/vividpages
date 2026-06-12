import { createHash } from 'node:crypto';

import { getQueue } from '@vividpages/core/queues';
import { putObject } from '@vividpages/core/storage';
import { books, getDb, pipelineRuns } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { listBooksWithLatestRun } from '@/lib/queries';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits';

/**
 * POST /api/books — upload an EPUB (multipart field 'file') and kick off the
 * ingest pipeline. Returns 201 {book} or 409 with the existing bookId when
 * the same file (by sha256) was already uploaded by this user.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field." },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.epub')) {
    return NextResponse.json({ error: 'File must be an .epub.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 100 MB).' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // EPUBs are zip archives; every zip starts with the 'PK' magic bytes.
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return NextResponse.json({ error: 'File is not a valid EPUB.' }, { status: 400 });
  }

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const db = getDb();

  const existing = await db.query.books.findFirst({
    where: and(eq(books.userId, userId), eq(books.sha256, sha256)),
    columns: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'This EPUB has already been uploaded.', bookId: existing.id },
      { status: 409 },
    );
  }

  const epubObjectKey = `${userId}/${sha256}.epub`;
  await putObject('epubs', epubObjectKey, buf, 'application/epub+zip');

  let book: typeof books.$inferSelect;
  let runId: string;
  try {
    // Book + run are created atomically so a failure can't leave an
    // 'ingesting' book with no pipeline run.
    ({ book, runId } = await db.transaction(async (tx) => {
      // Placeholder title from the filename; ingest overwrites it with the
      // authoritative EPUB metadata. Status starts at 'ingesting' because the
      // job is enqueued in this same request.
      const [created] = await tx
        .insert(books)
        .values({
          userId,
          title: file.name.replace(/\.epub$/i, ''),
          sha256,
          epubObjectKey,
          status: 'ingesting',
        })
        .returning();
      if (!created) throw new Error('Book insert returned no row');

      const [run] = await tx
        .insert(pipelineRuns)
        .values({ bookId: created.id, stage: 'ingest', currentStep: 'Queued', status: 'running' })
        .returning({ id: pipelineRuns.id });
      if (!run) throw new Error('Pipeline run insert returned no row');

      return { book: created, runId: run.id };
    }));
  } catch (error) {
    // Unique-violation race: the same file was uploaded concurrently.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'This EPUB has already been uploaded.' },
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
    console.error(`books: failed to enqueue ingest job for book ${book.id}:`, error);
    const enqueueError = 'failed to enqueue ingest job';
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
      console.error(`books: failed to mark book ${book.id} as failed:`, bookkeepingError);
    }
    return NextResponse.json(
      { error: 'Failed to enqueue ingest job.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ book }, { status: 201 });
}

/**
 * GET /api/books — the session user's books, newest first, each with its
 * latest pipeline run (or null).
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  return NextResponse.json({ books: await listBooksWithLatestRun(userId) });
}
