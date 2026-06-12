import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { findOwnedBook } from '@/lib/find-owned-book';
import { getChapterWithScenes, listChaptersWithScenes } from '@/lib/queries';

type RouteContext = { params: Promise<{ id: string }> };

// Chapter text only changes on re-ingest (which makes a new book row), so
// the browser may keep it for a while — but it is per-user private content.
const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=3600' };

/**
 * GET /api/books/[id]/content — the Reader's data source, in two modes:
 *
 * - Index (no query): every chapter's idx/title plus its scene spans, WITHOUT
 *   chapter text, so the initial payload stays small.
 * - `?chapter=N`: that chapter's full text plus its scene spans; the Reader
 *   fetches chapters on demand and caches them client-side.
 *
 * 404 for missing books and other users' books (no existence leak).
 */
export async function GET(request: Request, { params }: RouteContext) {
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

  const chapterParam = new URL(request.url).searchParams.get('chapter');
  if (chapterParam !== null) {
    // Present-but-invalid is a 400, including the empty string (which
    // Number() would otherwise silently coerce to 0), NaN, negatives and
    // non-integers.
    const chapterIdx = chapterParam.trim() === '' ? Number.NaN : Number(chapterParam);
    if (!Number.isInteger(chapterIdx) || chapterIdx < 0) {
      return NextResponse.json({ error: 'Invalid chapter index.' }, { status: 400 });
    }
    const chapter = await getChapterWithScenes(book.id, chapterIdx);
    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found.' }, { status: 404 });
    }
    return NextResponse.json({ chapter }, { headers: CACHE_HEADERS });
  }

  const chapters = (await listChaptersWithScenes(book.id)).map(
    ({ idx, title, scenes }) => ({ idx, title, scenes }),
  );
  return NextResponse.json({ chapters }, { headers: CACHE_HEADERS });
}
