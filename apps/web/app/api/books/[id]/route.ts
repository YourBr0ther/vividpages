import { deleteObject, type Bucket } from '@vividpages/core/storage';
import { books, chapters, getDb, pipelineRuns, scenes } from '@vividpages/db';
import { count, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { findOwnedBook } from '@/lib/find-owned-book';

type RouteContext = { params: Promise<{ id: string }> };

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
