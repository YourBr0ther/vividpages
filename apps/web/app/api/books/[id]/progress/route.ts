import { getDb, readingProgress } from '@vividpages/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { findOwnedBook } from '@/lib/find-owned-book';
import { getReadingProgress } from '@/lib/queries';

type RouteContext = { params: Promise<{ id: string }> };

const putSchema = z.object({
  chapterIdx: z.number().int().min(0),
  sceneGlobalIdx: z.number().int().min(0),
});

/** GET /api/books/[id]/progress — the saved reading position, or null. */
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

  const progress = await getReadingProgress(userId, book.id);
  return NextResponse.json(
    { progress: progress ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * PUT /api/books/[id]/progress — upserts the reading position. The Reader
 * debounces calls to this as the reader scrolls; last write wins.
 */
export async function PUT(request: Request, { params }: RouteContext) {
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

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid progress payload.' }, { status: 400 });
  }

  const { chapterIdx, sceneGlobalIdx } = parsed.data;
  await getDb()
    .insert(readingProgress)
    .values({ userId, bookId: book.id, chapterIdx, sceneGlobalIdx })
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.bookId],
      set: { chapterIdx, sceneGlobalIdx, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
