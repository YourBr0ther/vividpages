import { books, chapters, getDb } from '@vividpages/db';
import { eq } from 'drizzle-orm';

import { parseEpub } from '../epub/parse';
import { extractChapterText } from '../epub/text';
import { getQueue, type StageJobPayload } from '../queues';
import { getObject, putObject } from '../storage';
import { reportProgress, setBookStatus } from './progress';

/** Cover media types we map to a conventional file extension. */
const MEDIA_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/**
 * Maps an image media type to a file extension for the stored cover object.
 * Unknown subtypes fall back to the sanitized subtype itself (or 'img' when
 * even that is unusable) so the key is always well-formed.
 */
export function extensionForMediaType(mediaType: string): string {
  const normalized = mediaType.trim().toLowerCase().split(';')[0]!.trim();
  const known = MEDIA_TYPE_EXT[normalized];
  if (known) return known;
  const subtype = normalized.split('/')[1] ?? '';
  const cleaned = subtype.replace(/[^a-z0-9]/g, '');
  return cleaned || 'img';
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

const INSERT_CHUNK_SIZE = 50;

/**
 * Ingest stage: EPUB bytes -> book metadata + cover object + chapters rows,
 * then enqueues the segment stage.
 *
 * Idempotent on retry: existing chapters for the book are deleted first
 * (cascading to scenes), so a re-run after a partial failure rebuilds from
 * scratch instead of hitting unique(bookId, idx) violations.
 *
 * Errors deliberately propagate: the worker processor wraps stage functions
 * and handles failRun/setBookStatus('failed') + BullMQ retries.
 */
export async function runIngest({ bookId, runId }: StageJobPayload): Promise<void> {
  const db = getDb();

  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) throw new Error(`ingest: book ${bookId} not found`);
  if (!book.epubObjectKey) throw new Error(`ingest: book ${bookId} has no epubObjectKey`);

  await setBookStatus(bookId, 'ingesting');
  await reportProgress(runId, { stage: 'ingest', percent: 0, currentStep: 'Fetching EPUB' });

  const epub = await getObject('epubs', book.epubObjectKey);

  await reportProgress(runId, { stage: 'ingest', percent: 5, currentStep: 'Parsing EPUB' });
  const parsed = await parseEpub(epub);

  for (const entry of parsed.skipped) {
    console.log(`[ingest ${bookId}] skipped ${entry.path}: ${entry.reason}`);
  }

  // Cover: stored under a book-scoped key so DELETE can clean it up.
  let coverObjectKey = book.coverObjectKey;
  if (parsed.cover) {
    coverObjectKey = `${bookId}/cover.${extensionForMediaType(parsed.cover.mediaType)}`;
    await putObject('covers', coverObjectKey, parsed.cover.data, parsed.cover.mediaType);
  }

  // Idempotency: wipe any chapters from a previous (partial) attempt; the FK
  // cascade also removes their scenes.
  await db.delete(chapters).where(eq(chapters.bookId, bookId));

  const total = parsed.chapters.length;
  if (total === 0) throw new Error(`ingest: book ${bookId} produced no chapters`);

  let bookWordCount = 0;
  const rows: (typeof chapters.$inferInsert)[] = [];
  for (const [i, chapter] of parsed.chapters.entries()) {
    // Leading embedded headings (chapter title / POV marker) are stripped by
    // extractChapterText; we store the clean text and discard the headings
    // (the ncx title on the row already covers them). A chapter that is ONLY
    // headings (title-page fragment) still gets a row with empty text — the
    // segment stage's segmentChapter() returns [] for it, so no scenes.
    const extracted = extractChapterText(chapter.html);
    const wordCount = countWords(extracted.text);
    bookWordCount += wordCount;
    rows.push({
      bookId,
      idx: chapter.idx,
      title: chapter.title ?? null,
      text: extracted.text,
      paragraphs: extracted.paragraphs,
      sceneBreaks: extracted.sceneBreaks,
      wordCount,
    });
    if ((i + 1) % 10 === 0 || i + 1 === total) {
      await reportProgress(runId, {
        stage: 'ingest',
        // Extraction spans 10..80; the remaining 20 covers inserts + handoff.
        percent: 10 + ((i + 1) / total) * 70,
        currentStep: `Parsing chapter ${i + 1}/${total}`,
      });
    }
  }

  await reportProgress(runId, { stage: 'ingest', percent: 85, currentStep: 'Saving chapters' });
  for (const chunk of chunks(rows, INSERT_CHUNK_SIZE)) {
    await db.insert(chapters).values(chunk);
  }

  // EPUB metadata is authoritative; the placeholder title from the filename
  // is always overwritten (parseEpub itself falls back when the OPF lacks one).
  await db
    .update(books)
    .set({
      title: parsed.metadata.title,
      author: parsed.metadata.author ?? null,
      language: parsed.metadata.language ?? null,
      isbn: parsed.metadata.isbn ?? null,
      coverObjectKey,
      wordCount: bookWordCount,
    })
    .where(eq(books.id, bookId));

  await setBookStatus(bookId, 'segmenting');
  await reportProgress(runId, { stage: 'ingest', percent: 100, currentStep: 'Queued for segmentation' });
  await getQueue('segment').add('segment', { bookId, runId });
}
