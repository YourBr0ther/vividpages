import { getDb, images } from '@vividpages/db';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { findOwnedBook, UUID_RE } from '@/lib/find-owned-book';

type RouteContext = { params: Promise<{ subjectId: string }> };

const KINDS = ['character_portrait', 'scene_storyboard'] as const;
type SubjectKind = (typeof KINDS)[number];

function parseKind(value: string | null): SubjectKind | undefined {
  return KINDS.find((kind) => kind === value);
}

/**
 * GET /api/images/by-subject/[subjectId]?kind=… — every image version for one
 * subject (a character's portraits or a scene's storyboards), newest version
 * first, plus the id of the latest finished one. Drives the lightbox's
 * version stepper and its post-regenerate polling, so: no caching.
 *
 * The book is resolved through the subject's image rows; 404 when the subject
 * has no images or its book isn't the caller's (no existence leak).
 */
export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const kind = parseKind(new URL(request.url).searchParams.get('kind'));
  if (!kind) {
    return NextResponse.json(
      { error: "Expected ?kind=character_portrait | scene_storyboard." },
      { status: 400 },
    );
  }

  const { subjectId } = await params;
  if (!UUID_RE.test(subjectId)) {
    return NextResponse.json({ error: 'Subject not found.' }, { status: 404 });
  }

  const rows = await getDb()
    .select({
      id: images.id,
      bookId: images.bookId,
      version: images.version,
      status: images.status,
      createdAt: images.createdAt,
    })
    .from(images)
    .where(and(eq(images.subjectId, subjectId), eq(images.kind, kind)))
    .orderBy(desc(images.version), desc(images.createdAt));

  // Subject ids are UUIDs, so all rows share one book; ownership via that book.
  const bookId = rows[0]?.bookId;
  if (!bookId || !(await findOwnedBook(bookId, userId))) {
    return NextResponse.json({ error: 'Subject not found.' }, { status: 404 });
  }

  return NextResponse.json(
    {
      versions: rows.map(({ id, version, status, createdAt }) => ({
        id,
        version,
        status,
        createdAt,
      })),
      latestDoneId: rows.find((row) => row.status === 'done')?.id ?? null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
