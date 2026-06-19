import { createHash } from 'node:crypto';

import { putObject } from '@vividpages/core/storage';
import { books, getDb, userSettings } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { isUniqueViolation } from '@/lib/db-errors';
import { listBooksWithLatestRun } from '@/lib/queries';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits';

/**
 * POST /api/books — upload an EPUB (multipart field 'file'). Returns 201
 * {book} or 409 with the existing bookId when the same file (by sha256) was
 * already uploaded by this user.
 *
 * The upload no longer kicks off the pipeline. The book is created at status
 * 'uploading' with no pipeline run; the upload wizard collects the up-front
 * choices (mature? + style preset) and its Finish (POST
 * /api/books/[id]/start) is what enqueues the ingest head, which then
 * auto-chains the whole pipeline to finished art.
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

  // Seed the new book's mature-content flag from the uploader's default
  // (false when no settings row exists yet). The wizard's mature step starts
  // pre-filled from this and overrides it on Finish.
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
    columns: { matureContentDefault: true },
  });
  const matureContent = settings?.matureContentDefault ?? false;

  let book: typeof books.$inferSelect;
  try {
    // Placeholder title from the filename; ingest overwrites it with the
    // authoritative EPUB metadata. Status starts at 'uploading' and there is
    // no pipeline run yet — the wizard's Finish creates the run and enqueues
    // ingest.
    const [created] = await db
      .insert(books)
      .values({
        userId,
        title: file.name.replace(/\.epub$/i, ''),
        sha256,
        epubObjectKey,
        status: 'uploading',
        matureContent,
      })
      .returning();
    if (!created) throw new Error('Book insert returned no row');
    book = created;
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
