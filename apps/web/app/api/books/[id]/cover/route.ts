import { Readable } from 'node:stream';

import { getObjectStream } from '@vividpages/core/storage';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { findOwnedBook } from '@/lib/find-owned-book';

type RouteContext = { params: Promise<{ id: string }> };

/** Content types by cover key extension (ingest derives the ext from the EPUB's media type). */
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * GET /api/books/[id]/cover — streams the book's cover image from MinIO.
 * 404 for missing books, other users' books (no existence leak), and books
 * without a cover. Covers are stored under a per-book key that only changes
 * content on re-ingest, so long-lived private caching is safe enough; the
 * client cache-busts when it matters.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = await params;
  const book = await findOwnedBook(id, userId);
  if (!book?.coverObjectKey) {
    return NextResponse.json({ error: 'Cover not found.' }, { status: 404 });
  }

  let stream: Readable;
  try {
    stream = await getObjectStream('covers', book.coverObjectKey);
  } catch (error) {
    // DB says there's a cover but the object is gone (or storage hiccuped):
    // log and treat as not found rather than 500ing the whole card.
    console.error(`cover: failed to read s3://covers/${book.coverObjectKey}:`, error);
    return NextResponse.json({ error: 'Cover not found.' }, { status: 404 });
  }

  const ext = book.coverObjectKey.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
