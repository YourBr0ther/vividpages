import { deleteObject, type Bucket } from '@vividpages/core/storage';
import { books, chapters, getDb, pipelineRuns, scenes } from '@vividpages/db';
import { count, desc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { findOwnedBook } from '@/lib/find-owned-book';

type RouteContext = { params: Promise<{ id: string }> };

/** Mutable per-book settings. Currently just the mature-content flag. */
const patchSchema = z.object({
  matureContent: z.boolean(),
});

/**
 * GET /api/books/[id] — single book with latest pipeline run and
 * chapter/scene counts. 404 for missing books AND books owned by someone
 * else (no existence leak).
 */
export async function GET(_request: Request, { params }: RouteContext) {
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

  const db = getDb();
  const [[latestRun], [chapterCount], [sceneCount]] = await Promise.all([
    db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.bookId, book.id))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1),
    db.select({ value: count() }).from(chapters).where(eq(chapters.bookId, book.id)),
    db.select({ value: count() }).from(scenes).where(eq(scenes.bookId, book.id)),
  ]);

  return NextResponse.json({
    book: {
      ...book,
      latestRun: latestRun ?? null,
      chapterCount: chapterCount?.value ?? 0,
      sceneCount: sceneCount?.value ?? 0,
    },
  });
}

/**
 * PATCH /api/books/[id] — update mutable per-book settings (the mature-content
 * flag). Auth + ownership enforced; 404 for missing or other users' books.
 * Re-running the pipeline is what applies the change to existing scenes; this
 * only persists the flag.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid book settings.' },
      { status: 400 },
    );
  }

  const [updated] = await getDb()
    .update(books)
    .set({ matureContent: parsed.data.matureContent, updatedAt: new Date() })
    .where(eq(books.id, book.id))
    .returning();

  return NextResponse.json({ book: updated });
}

/**
 * DELETE /api/books/[id] — removes the book row (FK cascades take chapters,
 * scenes, runs, etc.) and best-effort deletes the stored EPUB and cover.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
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

  await getDb().delete(books).where(eq(books.id, book.id));

  // Best-effort object cleanup: the DB row (source of truth) is already gone;
  // an orphaned object in MinIO is harmless, so failures only get logged.
  const objects: Array<[Bucket, string | null]> = [
    ['epubs', book.epubObjectKey],
    ['covers', book.coverObjectKey],
  ];
  for (const [bucket, key] of objects) {
    if (!key) continue;
    try {
      await deleteObject(bucket, key);
    } catch (err) {
      console.error(`books: failed to delete s3://${bucket}/${key}:`, err);
    }
  }

  return new NextResponse(null, { status: 204 });
}
