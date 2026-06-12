import { books, chapters, getDb, pipelineRuns, readingProgress, scenes } from '@vividpages/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { ChapterMeta, ChapterPayload, SceneRef } from './reader-types';

export type BookRow = typeof books.$inferSelect;
export type PipelineRunRow = typeof pipelineRuns.$inferSelect;

export type BookWithLatestRun = BookRow & { latestRun: PipelineRunRow | null };

/**
 * The user's books, newest first, each with its latest pipeline run (or
 * null). Shared by GET /api/books and the Bookcase server component so both
 * return the same shape without a server-side fetch round-trip.
 */
export async function listBooksWithLatestRun(userId: string): Promise<BookWithLatestRun[]> {
  const db = getDb();
  const rows = await db.query.books.findMany({
    where: eq(books.userId, userId),
    orderBy: desc(books.createdAt),
  });

  const latestRunByBook = new Map<string, PipelineRunRow>();
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

  return rows.map((book) => ({ ...book, latestRun: latestRunByBook.get(book.id) ?? null }));
}

/**
 * The book's table of contents with per-chapter scene spans: one chapters
 * query (no text — chapter bodies can be megabytes) plus one grouped scenes
 * query. Used by the content API's index mode, the reader shell, and the
 * detail page's chapter list.
 */
export async function listChaptersWithScenes(
  bookId: string,
): Promise<Array<ChapterMeta & { scenes: SceneRef[] }>> {
  const db = getDb();
  const [chapterRows, sceneRows] = await Promise.all([
    db
      .select({
        id: chapters.id,
        idx: chapters.idx,
        title: chapters.title,
        wordCount: chapters.wordCount,
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.idx)),
    db
      .select({
        chapterId: scenes.chapterId,
        globalIdx: scenes.globalIdx,
        idx: scenes.idx,
        startOffset: scenes.startOffset,
        endOffset: scenes.endOffset,
      })
      .from(scenes)
      .where(eq(scenes.bookId, bookId))
      .orderBy(asc(scenes.globalIdx)),
  ]);

  const scenesByChapter = new Map<string, SceneRef[]>();
  for (const { chapterId, ...scene } of sceneRows) {
    const list = scenesByChapter.get(chapterId);
    if (list) list.push(scene);
    else scenesByChapter.set(chapterId, [scene]);
  }

  return chapterRows.map(({ id, ...chapter }) => {
    const chapterScenes = scenesByChapter.get(id) ?? [];
    return { ...chapter, sceneCount: chapterScenes.length, scenes: chapterScenes };
  });
}

/** One chapter's full text plus its scene spans, or undefined if no such chapter. */
export async function getChapterWithScenes(
  bookId: string,
  chapterIdx: number,
): Promise<ChapterPayload | undefined> {
  const db = getDb();
  const chapter = await db.query.chapters.findFirst({
    where: and(eq(chapters.bookId, bookId), eq(chapters.idx, chapterIdx)),
    columns: { id: true, idx: true, title: true, text: true },
  });
  if (!chapter) return undefined;

  const sceneRows = await db
    .select({
      globalIdx: scenes.globalIdx,
      idx: scenes.idx,
      startOffset: scenes.startOffset,
      endOffset: scenes.endOffset,
    })
    .from(scenes)
    .where(eq(scenes.chapterId, chapter.id))
    .orderBy(asc(scenes.idx));

  return { idx: chapter.idx, title: chapter.title, text: chapter.text, scenes: sceneRows };
}

/** The user's saved reading position for a book, or undefined. */
export async function getReadingProgress(userId: string, bookId: string) {
  return getDb().query.readingProgress.findFirst({
    where: and(eq(readingProgress.userId, userId), eq(readingProgress.bookId, bookId)),
  });
}
