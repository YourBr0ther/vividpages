import {
  books,
  chapters,
  characters,
  getDb,
  illustrationPoints,
  images,
  pipelineRuns,
  readingProgress,
  scenes,
  userSettings,
  type ImageKind,
  type PipelineRunStatus,
} from '@vividpages/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type {
  ChapterIllustration,
  ChapterMeta,
  ChapterPayload,
  ScenePara,
  SceneRef,
} from './reader-types';

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

/** The latest finished image for one subject, as the Reader/gallery need it. */
interface LatestImage {
  id: string;
  subjectId: string;
  width: number | null;
  height: number | null;
  version: number;
}

/**
 * The latest 'done' image per subject for a book+kind, as ONE grouped query
 * (no per-subject N+1): fetch every finished row, newest version first, and
 * keep the first row seen per subject.
 */
async function latestDoneImagesBySubject(
  bookId: string,
  kind: ImageKind,
): Promise<Map<string, LatestImage>> {
  const rows = await getDb()
    .select({
      id: images.id,
      subjectId: images.subjectId,
      width: images.width,
      height: images.height,
      version: images.version,
    })
    .from(images)
    .where(and(eq(images.bookId, bookId), eq(images.kind, kind), eq(images.status, 'done')))
    .orderBy(desc(images.version));

  const bySubject = new Map<string, LatestImage>();
  for (const row of rows) {
    if (row.subjectId && !bySubject.has(row.subjectId)) {
      bySubject.set(row.subjectId, { ...row, subjectId: row.subjectId });
    }
  }
  return bySubject;
}

/**
 * Split a span of chapter text into paragraphs, each tagged with its absolute
 * start offset into the chapter. Mirrors the reader's `\n\n` split while
 * tracking where each kept paragraph began, so illustration points (whose
 * `charOffset` is a paragraph-start offset) can be matched to a boundary.
 */
function splitScenePara(text: string, startOffset: number, endOffset: number): ScenePara[] {
  const out: ScenePara[] = [];
  const span = text.slice(startOffset, endOffset);
  let cursor = startOffset;
  for (const segment of span.split('\n\n')) {
    const trimmed = segment.trim();
    if (trimmed) {
      // The kept paragraph's absolute start is the segment's start plus its
      // leading whitespace (so it lines up with a paragraph-start charOffset).
      const lead = segment.length - segment.trimStart().length;
      out.push({ text: trimmed, start: cursor + lead });
    }
    // +2 for the '\n\n' separator consumed by split.
    cursor += segment.length + 2;
  }
  return out;
}

/**
 * One chapter's full text, its scenes (spans + split paragraphs), and the
 * chapter's illustration points (latest finished storyboard per point, ordered
 * by charOffset). Two grouped queries — scenes, and points joined to their
 * latest done images — so no per-point or per-scene N+1. Undefined if no such
 * chapter.
 */
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

  const [sceneRows, pointRows, artBySubject] = await Promise.all([
    db
      .select({
        id: scenes.id,
        globalIdx: scenes.globalIdx,
        idx: scenes.idx,
        startOffset: scenes.startOffset,
        endOffset: scenes.endOffset,
      })
      .from(scenes)
      .where(eq(scenes.chapterId, chapter.id))
      .orderBy(asc(scenes.idx)),
    db
      .select({ id: illustrationPoints.id, charOffset: illustrationPoints.charOffset })
      .from(illustrationPoints)
      .where(eq(illustrationPoints.chapterId, chapter.id))
      .orderBy(asc(illustrationPoints.charOffset)),
    latestDoneImagesBySubject(bookId, 'scene_storyboard'),
  ]);

  // A point only renders once its storyboard has finished; mid-pipeline points
  // (no done image yet) are simply skipped, like the old image:null path.
  const illustrationPointsOut: ChapterIllustration[] = [];
  for (const point of pointRows) {
    const art = artBySubject.get(point.id);
    if (!art) continue;
    illustrationPointsOut.push({
      imageId: art.id,
      subjectId: point.id,
      charOffset: point.charOffset,
      width: art.width,
      height: art.height,
      version: art.version,
    });
  }

  return {
    idx: chapter.idx,
    title: chapter.title,
    text: chapter.text,
    scenes: sceneRows.map(({ id: _id, ...scene }) => ({
      ...scene,
      paragraphs: splitScenePara(chapter.text, scene.startOffset, scene.endOffset),
    })),
    illustrationPoints: illustrationPointsOut,
  };
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
  /** Latest finished portrait image id, or null when none has been painted. */
  portraitImageId: string | null;
  /** Thumb URL for the latest portrait (derived from portraitImageId). */
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
  const [rows, portraitByCharacter] = await Promise.all([
    getDb()
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
      .orderBy(desc(characters.sceneCount), asc(characters.name)),
    latestDoneImagesBySubject(bookId, 'character_portrait'),
  ]);

  return rows.map((row) => {
    const portraitImageId = portraitByCharacter.get(row.id)?.id ?? null;
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      role: toCastRole(row.role),
      profile: toCastProfile(row.profile),
      appearanceToken: row.appearanceToken,
      sceneCount: row.sceneCount,
      portraitImageId,
      imageUrl: portraitImageId ? `/api/images/${portraitImageId}?thumb=1` : null,
    };
  });
}

/**
 * Number of finished illustrations (portraits + storyboards) for a book,
 * counting each subject once however many versions it has.
 */
export async function countDoneImages(bookId: string): Promise<number> {
  const [row] = await getDb()
    .select({
      count: sql<number>`count(distinct (${images.kind}, ${images.subjectId}))::int`,
    })
    .from(images)
    .where(and(eq(images.bookId, bookId), eq(images.status, 'done')));
  return row?.count ?? 0;
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

// ---------------------------------------------------------------------------
// Jobs dashboard
// ---------------------------------------------------------------------------

/** A pipeline run paired with its book's title, for the cross-book jobs view. */
export interface JobRun {
  id: string;
  bookId: string;
  bookTitle: string;
  stage: string;
  status: PipelineRunStatus;
  percent: number;
  currentStep: string | null;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  /** running + recent heartbeat (mirrors isActiveRun). */
  active: boolean;
}

/** A failed image with the context needed to retry it. */
export interface FailedImage {
  id: string;
  bookId: string;
  bookTitle: string;
  kind: ImageKind;
  subjectId: string | null;
  subjectName: string | null;
  error: string | null;
  createdAt: string;
}

export interface JobsData {
  runs: JobRun[];
  failedImages: FailedImage[];
  /** Rough LLM token tally across all of the user's runs (analyze/profiles). */
  totals: { tokensIn: number; tokensOut: number };
}

/** Human label per pipeline stage, for the jobs view. */
export const STAGE_LABELS: Record<string, string> = {
  ingest: 'Ingest',
  segment: 'Segment',
  analyze: 'Analyze',
  profiles: 'Profiles',
  imagine: 'Imagine',
};

/** Stages whose token tallies are meaningful (LLM stages). */
const LLM_STAGES = new Set(['analyze', 'profiles']);

/**
 * Everything the Jobs dashboard renders, gathered across all of the user's
 * books with no per-book N+1: one query for the user's book ids, then a
 * recent-runs query and a failed-images query, both scoped with `inArray`
 * over those ids and joined back to titles in memory. Character names are
 * resolved in a single follow-up `inArray` over the failed portraits'
 * subject ids.
 */
export async function getJobsData(userId: string): Promise<JobsData> {
  const db = getDb();
  const bookRows = await db
    .select({ id: books.id, title: books.title })
    .from(books)
    .where(eq(books.userId, userId));

  if (bookRows.length === 0) {
    return { runs: [], failedImages: [], totals: { tokensIn: 0, tokensOut: 0 } };
  }

  const titleByBook = new Map(bookRows.map((b) => [b.id, b.title]));
  const bookIds = bookRows.map((b) => b.id);

  const [runRows, failedRows, totalRow] = await Promise.all([
    db
      .select()
      .from(pipelineRuns)
      .where(inArray(pipelineRuns.bookId, bookIds))
      .orderBy(desc(pipelineRuns.updatedAt))
      .limit(50),
    db
      .select({
        id: images.id,
        bookId: images.bookId,
        kind: images.kind,
        subjectId: images.subjectId,
        error: images.error,
        createdAt: images.createdAt,
      })
      .from(images)
      .where(and(inArray(images.bookId, bookIds), eq(images.status, 'failed')))
      .orderBy(desc(images.createdAt))
      .limit(50),
    db
      .select({
        tokensIn: sql<number>`coalesce(sum(${pipelineRuns.tokensIn}), 0)::bigint`,
        tokensOut: sql<number>`coalesce(sum(${pipelineRuns.tokensOut}), 0)::bigint`,
      })
      .from(pipelineRuns)
      .where(inArray(pipelineRuns.bookId, bookIds)),
  ]);

  // Resolve character names for failed portraits in one grouped lookup.
  const portraitSubjectIds = failedRows
    .filter((r) => r.kind === 'character_portrait' && r.subjectId)
    .map((r) => r.subjectId as string);
  const nameById = new Map<string, string>();
  if (portraitSubjectIds.length > 0) {
    const charRows = await db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(inArray(characters.id, portraitSubjectIds));
    for (const c of charRows) nameById.set(c.id, c.name);
  }

  const runs: JobRun[] = runRows.map((r) => ({
    id: r.id,
    bookId: r.bookId,
    bookTitle: titleByBook.get(r.bookId) ?? 'Untitled',
    stage: r.stage,
    status: r.status,
    percent: r.percent,
    currentStep: r.currentStep,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    active: isActiveRun(r),
  }));

  const failedImages: FailedImage[] = failedRows.map((r) => ({
    id: r.id,
    bookId: r.bookId,
    bookTitle: titleByBook.get(r.bookId) ?? 'Untitled',
    kind: r.kind,
    subjectId: r.subjectId,
    subjectName: r.subjectId ? (nameById.get(r.subjectId) ?? null) : null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    runs,
    failedImages,
    totals: {
      tokensIn: Number(totalRow[0]?.tokensIn ?? 0),
      tokensOut: Number(totalRow[0]?.tokensOut ?? 0),
    },
  };
}

export { LLM_STAGES };

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
