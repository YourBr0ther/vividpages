import { createHash } from 'node:crypto';

import { getQueue } from '@vividpages/core/queues';
import { putObject } from '@vividpages/core/storage';
import { books, getDb, pipelineRuns } from '@vividpages/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

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
  try {
    // Placeholder title from the filename; ingest overwrites it with the
    // authoritative EPUB metadata. Status starts at 'ingesting' because the
    // job is enqueued in this same request.
    const [created] = await db
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
    book = created;
  } catch (error) {
    // Unique-violation race: the same file was uploaded concurrently.
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        { error: 'This EPUB has already been uploaded.' },
        { status: 409 },
      );
    }
    throw error;
  }

  const [run] = await db
    .insert(pipelineRuns)
    .values({ bookId: book.id, stage: 'ingest', currentStep: 'Queued', status: 'running' })
    .returning({ id: pipelineRuns.id });
  if (!run) throw new Error('Pipeline run insert returned no row');

  await getQueue('ingest').add('ingest', { bookId: book.id, runId: run.id });

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

  const db = getDb();
  const rows = await db.query.books.findMany({
    where: eq(books.userId, userId),
    orderBy: desc(books.createdAt),
  });

  const latestRunByBook = new Map<string, typeof pipelineRuns.$inferSelect>();
  if (rows.length > 0) {
    const runs = await db
      .select()
      .from(pipelineRuns)
      .where(
        inArray(
          pipelineRuns.bookId,
          rows.map((b) => b.id),
        ),
      )
      .orderBy(desc(pipelineRuns.startedAt));
    // Rows arrive newest-first, so the first run seen per book is the latest.
    for (const run of runs) {
      if (!latestRunByBook.has(run.bookId)) latestRunByBook.set(run.bookId, run);
    }
  }

  return NextResponse.json({
    books: rows.map((book) => ({ ...book, latestRun: latestRunByBook.get(book.id) ?? null })),
  });
}
