import { chapters, getDb, scenes } from '@vividpages/db';
import { asc, eq } from 'drizzle-orm';

import type { StageJobPayload } from '../queues';
import { segmentChapter } from '../segment';
import { enqueueNextStage } from './chain';
import { reportProgress, setBookStatus } from './progress';

const INSERT_CHUNK_SIZE = 100;

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Segment stage: chapters -> scene rows with a book-wide running globalIdx.
 *
 * Idempotent on retry: existing scenes for the book are deleted before
 * re-inserting. Errors propagate to the worker processor wrapper (which
 * handles failRun/setBookStatus('failed') + BullMQ retries).
 */
export async function runSegment({ bookId, runId }: StageJobPayload): Promise<void> {
  const db = getDb();

  await setBookStatus(bookId, 'segmenting');
  await reportProgress(runId, { stage: 'segment', percent: 0, currentStep: 'Loading chapters' });

  const chapterRows = await db
    .select({
      id: chapters.id,
      idx: chapters.idx,
      text: chapters.text,
      paragraphs: chapters.paragraphs,
      sceneBreaks: chapters.sceneBreaks,
    })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.idx));
  if (chapterRows.length === 0) {
    throw new Error(`segment: book ${bookId} has no chapters (did ingest run?)`);
  }

  // Idempotency: wipe scenes from a previous (partial) attempt.
  await db.delete(scenes).where(eq(scenes.bookId, bookId));

  const total = chapterRows.length;
  let globalIdx = 0;
  const rows: (typeof scenes.$inferInsert)[] = [];
  for (const [i, chapter] of chapterRows.entries()) {
    const spans = segmentChapter({
      text: chapter.text,
      paragraphs: chapter.paragraphs ?? [],
      sceneBreaks: chapter.sceneBreaks ?? [],
    });
    for (const [idx, span] of spans.entries()) {
      rows.push({
        chapterId: chapter.id,
        bookId,
        idx,
        globalIdx: globalIdx++,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        wordCount: span.wordCount,
      });
    }
    if ((i + 1) % 10 === 0 || i + 1 === total) {
      await reportProgress(runId, {
        stage: 'segment',
        percent: ((i + 1) / total) * 80,
        currentStep: `Segmenting chapter ${i + 1}/${total}`,
      });
    }
  }

  await reportProgress(runId, { stage: 'segment', percent: 90, currentStep: 'Saving scenes' });
  for (const chunk of chunks(rows, INSERT_CHUNK_SIZE)) {
    await db.insert(scenes).values(chunk);
  }

  // The book is readable now. Auto-chain straight into analysis: the wizard's
  // single Finish runs the whole pipeline to finished art, so segment hands
  // off to analyze (which chains on through profiles → imagine) instead of
  // completing the run and waiting for a manual "run analysis" click.
  await reportProgress(runId, {
    stage: 'segment',
    percent: 100,
    currentStep: 'Scenes ready — queued for analysis',
  });
  await setBookStatus(bookId, 'analyzing');
  await enqueueNextStage('segment', { bookId, runId });
}
