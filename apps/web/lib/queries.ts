import {
  books,
  chapters,
  characters,
  getDb,
  pipelineRuns,
  readingProgress,
  scenes,
  userSettings,
} from '@vividpages/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { ChapterMeta, ChapterPayload, SceneRef } from './reader-types';

export type BookRow = typeof books.$inferSelect;
export type PipelineRunRow = typeof pipelineRuns.$inferSelect;

export type BookWithLatestRun = BookRow & {
  latestRun: PipelineRunRow | null;
  /** The user's saved reading position, or null when they haven't started. */
  progress: { chapterIdx: number; sceneGlobalIdx: number } | null;
};

/**
 * The user's books, newest first, each with its latest pipeline run (or
 * null) and the user's reading progress (or null). Shared by GET /api/books
 * and the Bookcase server component so both return the same shape without a
 * server-side fetch round-trip.
 */
export async function listBooksWithLatestRun(userId: string): Promise<BookWithLatestRun[]> {
  const db = getDb();
  const rows = await db.query.books.findMany({
    where: eq(books.userId, userId),
    orderBy: desc(books.createdAt),
  });

  const latestRunByBook = new Map<string, PipelineRunRow>();
  const progressByBook = new Map<string, { chapterIdx: number; sceneGlobalIdx: number }>();
  if (rows.length > 0) {
    const bookIds = rows.map((b) => b.id);
    const [runs, progressRows] = await Promise.all([
      db
        .select()
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.bookId, bookIds))
        .orderBy(desc(pipelineRuns.startedAt)),
      db
        .select({
          bookId: readingProgress.bookId,
          chapterIdx: readingProgress.chapterIdx,
          sceneGlobalIdx: readingProgress.sceneGlobalIdx,
        })
        .from(readingProgress)
        .where(
          and(eq(readingProgress.userId, userId), inArray(readingProgress.bookId, bookIds)),
        ),
    ]);
    // Runs arrive newest-first, so the first run seen per book is the latest.
    for (const run of runs) {
      if (!latestRunByBook.has(run.bookId)) latestRunByBook.set(run.bookId, run);
    }
    for (const { bookId, ...position } of progressRows) {
      progressByBook.set(bookId, position);
    }
  }

  return rows.map((book) => ({
    ...book,
    latestRun: latestRunByBook.get(book.id) ?? null,
    progress: progressByBook.get(book.id) ?? null,
  }));
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

// ---------------------------------------------------------------------------
// Cast & pipeline
// ---------------------------------------------------------------------------

/** Narrative roles in cast-gallery display order. */
export const CAST_ROLE_ORDER = ['protagonist', 'antagonist', 'supporting', 'minor'] as const;
export type CastRole = (typeof CAST_ROLE_ORDER)[number];

/** The visual profile jsonb, narrowed to the fields the UI renders. */
export interface CastProfile {
  hair: string | null;
  eyes: string | null;
  skin: string | null;
  build: string | null;
  age: string | null;
  attire: string | null;
  distinguishing: string | null;
  oneLine: string | null;
}

export interface CastMember {
  id: string;
  name: string;
  aliases: string[];
  /** Unknown/null roles (mid-pipeline) are coerced to 'minor'. */
  role: CastRole;
  profile: CastProfile | null;
  appearanceToken: string | null;
  sceneCount: number;
  /** Portrait URL pathway; portraits arrive in M5, so null for now. */
  imageUrl: string | null;
}

const CAST_ROLES = new Set<string>(CAST_ROLE_ORDER);

function toCastRole(role: string | null): CastRole {
  return role && CAST_ROLES.has(role) ? (role as CastRole) : 'minor';
}

/** Defensive narrowing of the untyped profile jsonb column. */
function toCastProfile(raw: unknown): CastProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const field = (key: keyof CastProfile): string | null => {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  return {
    hair: field('hair'),
    eyes: field('eyes'),
    skin: field('skin'),
    build: field('build'),
    age: field('age'),
    attire: field('attire'),
    distinguishing: field('distinguishing'),
    oneLine: field('oneLine'),
  };
}

/**
 * The book's full cast, most-seen first. Shared by the cast gallery and the
 * detail page's cast preview strip (which slices the top of this list).
 */
export async function listCast(bookId: string): Promise<CastMember[]> {
  const rows = await getDb()
    .select({
      id: characters.id,
      name: characters.name,
      aliases: characters.aliases,
      role: characters.role,
      profile: characters.profile,
      appearanceToken: characters.appearanceToken,
      sceneCount: characters.sceneCount,
    })
    .from(characters)
    .where(eq(characters.bookId, bookId))
    .orderBy(desc(characters.sceneCount), asc(characters.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    role: toCastRole(row.role),
    profile: toCastProfile(row.profile),
    appearanceToken: row.appearanceToken,
    sceneCount: row.sceneCount,
    imageUrl: null,
  }));
}

/** Number of scenes whose LLM analysis has completed. */
export async function countAnalyzedScenes(bookId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.analysisStatus, 'done')));
  return row?.count ?? 0;
}

/** The book's most recent pipeline run, or null when none exists. */
export async function getLatestRun(bookId: string): Promise<PipelineRunRow | null> {
  const [run] = await getDb()
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.bookId, bookId))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return run ?? null;
}

/**
 * A 'running' run that hasn't written progress within this window is treated
 * as stale (worker crashed / job evaporated) rather than active, so the user
 * isn't locked out of the pipeline controls forever.
 */
export const ACTIVE_RUN_STALE_MS = 10 * 60 * 1000;

export function isActiveRun(
  run: Pick<PipelineRunRow, 'status' | 'updatedAt'> | null,
): boolean {
  return (
    run?.status === 'running' && Date.now() - run.updatedAt.getTime() < ACTIVE_RUN_STALE_MS
  );
}

/**
 * The provider/model the pipeline would use for this book, resolved the same
 * way the worker does: book columns -> owner's user_settings -> defaults.
 * Display-only until the T28 settings UI lands.
 */
export async function resolveLlmDisplay(
  userId: string,
  book: { llmProvider: string | null; llmModel: string | null },
): Promise<{ provider: string; model: string }> {
  const settings = await getDb().query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  return {
    provider: book.llmProvider ?? settings?.llmProvider ?? 'ollama',
    model: book.llmModel ?? settings?.llmModel ?? 'llama3.1:8b',
  };
}
