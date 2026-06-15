import {
  OllamaError,
  StructuredOutputError,
  isImageProviderError,
  isSystemicImageError,
  type ImageGen,
  type LLM,
} from '@vividpages/ai';
import {
  books,
  chapters,
  characters,
  getDb,
  illustrationPoints,
  images,
  scenes,
  stylePresets,
  type Db,
  type ImageKind,
} from '@vividpages/db';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import sharp from 'sharp';

import { characterProfileSchema, type CharacterProfile } from '../analysis/profile-schema';
import { APPEARANCE_FIELD_ORDER, sanitizeTraitValue } from '../characters/appearance';
import { imagesPerChapter } from '../illustration/count';
import { isNonNarrative } from '../illustration/exclude';
import { planChapterIllustrations, type PlanRosterMember } from '../illustration/plan';
import {
  buildPortraitPrompt,
  buildScenePrompt,
  type CharacterForPrompt,
} from '../imaging/prompt';
import type { ImagineJobPayload } from '../queues';
import { redactSecrets } from '../redact';
import { deleteObject, putObject } from '../storage';
import { resolveImageGen, resolveLlm } from './llm';
import {
  completeRun,
  incrementRunTokens,
  isRunSuperseded,
  reportProgress,
  setBookStatus,
} from './progress';

/**
 * A home GPU box blips: a single dropped health ping or one slow generation is
 * not "the server is gone". Retry the same image this many times (with a
 * re-health-check + backoff between) before counting it as a real failure.
 */
const TRANSIENT_RETRY_ATTEMPTS = 3;
/** Backoff between transient retries (ms). */
const TRANSIENT_BACKOFF_MS = [5_000, 15_000, 30_000];
/** Only when this many images fail back-to-back do we treat the run as doomed. */
const CONSECUTIVE_SYSTEMIC_LIMIT = 4;
/** Upfront health check: retries before failing the stage. */
const HEALTH_CHECK_ATTEMPTS = 4;
const HEALTH_CHECK_BACKOFF_MS = 10_000;

/** If the first this-many generations ALL fail (e.g. bad prompts), bail early. */
const EARLY_FAILURE_WINDOW = 5;

/** OllamaError codes that indicate the LLM planning pass cannot succeed at all. */
const SYSTEMIC_OLLAMA_CODES = new Set(['NETWORK', 'TIMEOUT', 'MODEL_NOT_FOUND']);

/** Phase 0 owns the first slice of the progress bar; Phase 1 the remainder. */
const PLANNING_PERCENT_END = 25;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Style preset used when the book doesn't pin one. */
const DEFAULT_STYLE_SLUG = 'painterly-fantasy';

/** Roles that get a portrait ('minor' characters are skipped). */
const PORTRAIT_ROLES = new Set(['protagonist', 'antagonist', 'supporting']);

/** 3:4 portrait — Z-Image/SD3 latents want multiples of 64. */
const PORTRAIT_WIDTH = 832;
const PORTRAIT_HEIGHT = 1216;
/** 7:4 wide storyboard frame. */
const SCENE_WIDTH = 1344;
const SCENE_HEIGHT = 768;

const WEBP_QUALITY = 82;
const THUMB_WIDTH = 384;

const WORKFLOW = 'zimage-t2i';

/** Max characters joined into one scene prompt. */
const SCENE_CAST_LIMIT = 3;

interface WorkItem {
  kind: ImageKind;
  subjectId: string;
  version: number;
  width: number;
  height: number;
  prompt: string;
  negative: string;
  /** Human-readable progress label ('Painting Evie (3/12)'). */
  step: string;
}

/**
 * Parses a stored jsonb profile and re-applies trait sanitization as defense
 * in depth: rows profiled before the hygiene fixes may still carry hedging or
 * placeholder values, and those must never reach an image prompt.
 */
function sanitizedProfile(value: unknown): CharacterProfile | null {
  const parsed = characterProfileSchema.safeParse(value);
  if (!parsed.success) return null;
  const profile = parsed.data;
  for (const field of APPEARANCE_FIELD_ORDER) {
    profile[field] = sanitizeTraitValue(profile[field], field);
  }
  return profile;
}

interface PortraitCharacter extends CharacterForPrompt {
  id: string;
}

/** Characters that get a portrait, most-seen first. */
async function loadPortraitCharacters(db: Db, bookId: string): Promise<PortraitCharacter[]> {
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      role: characters.role,
      profile: characters.profile,
      appearanceToken: characters.appearanceToken,
    })
    .from(characters)
    .where(and(eq(characters.bookId, bookId), isNotNull(characters.appearanceToken)))
    .orderBy(desc(characters.sceneCount), asc(characters.createdAt));
  return rows
    .filter((r) => r.role !== null && PORTRAIT_ROLES.has(r.role))
    .map((r) => ({
      id: r.id,
      name: r.name,
      appearanceToken: r.appearanceToken,
      profile: sanitizedProfile(r.profile),
    }));
}

interface SceneRow {
  id: string;
  chapterId: string;
  globalIdx: number;
  startOffset: number;
  endOffset: number;
  summary: string | null;
  setting: string | null;
  timeOfDay: string | null;
  mood: string | null;
  keyVisualMoment: string | null;
}

/** Analyzed scenes in reading order. */
async function loadAnalyzedScenes(db: Db, bookId: string): Promise<SceneRow[]> {
  return db
    .select({
      id: scenes.id,
      chapterId: scenes.chapterId,
      globalIdx: scenes.globalIdx,
      startOffset: scenes.startOffset,
      endOffset: scenes.endOffset,
      summary: scenes.summary,
      setting: scenes.setting,
      timeOfDay: scenes.timeOfDay,
      mood: scenes.mood,
      keyVisualMoment: scenes.keyVisualMoment,
    })
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.analysisStatus, 'done')))
    .orderBy(asc(scenes.globalIdx));
}

/** Setting/mood/timeOfDay borrowed from an analyzed scene for a point's prompt. */
export interface SceneContext {
  setting: string | null;
  timeOfDay: string | null;
  mood: string | null;
}

const EMPTY_SCENE_CONTEXT: SceneContext = { setting: null, timeOfDay: null, mood: null };

/**
 * Resolves the setting/mood/timeOfDay for an illustration point. Points are
 * placed by char offset, decoupled from scene boundaries, so we borrow the
 * atmosphere from the analyzed scene that *contains* the offset within the same
 * chapter. Fallbacks, in order: containing scene → the chapter's first analyzed
 * scene → empty context (all nulls). Pure (no IO) so it is unit-testable.
 *
 * `chapterScenes` must already be filtered to the point's chapter (any order).
 */
export function sceneContextForOffset(
  chapterScenes: Array<{
    startOffset: number;
    endOffset: number;
    setting: string | null;
    timeOfDay: string | null;
    mood: string | null;
  }>,
  charOffset: number,
): SceneContext {
  if (chapterScenes.length === 0) return EMPTY_SCENE_CONTEXT;
  const containing = chapterScenes.find(
    (s) => charOffset >= s.startOffset && charOffset < s.endOffset,
  );
  // Fallback to the chapter's first scene (lowest startOffset) when the offset
  // lands in no scene span (e.g. a gap, or a quote located in trailing text).
  const first = chapterScenes.reduce((a, b) => (a.startOffset <= b.startOffset ? a : b));
  const src = containing ?? first;
  return { setting: src.setting, timeOfDay: src.timeOfDay, mood: src.mood };
}

interface IllustrationPointRow {
  id: string;
  chapterId: string;
  idx: number;
  charOffset: number;
  momentDescription: string;
  presentCharacterIds: string[];
}

/** Planned illustration points for the book, ordered for stable generation. */
async function loadIllustrationPoints(db: Db, bookId: string): Promise<IllustrationPointRow[]> {
  return db
    .select({
      id: illustrationPoints.id,
      chapterId: illustrationPoints.chapterId,
      idx: illustrationPoints.idx,
      charOffset: illustrationPoints.charOffset,
      momentDescription: illustrationPoints.momentDescription,
      presentCharacterIds: illustrationPoints.presentCharacterIds,
    })
    .from(illustrationPoints)
    .where(eq(illustrationPoints.bookId, bookId))
    .orderBy(asc(illustrationPoints.chapterId), asc(illustrationPoints.idx));
}

/**
 * Loads the prompt cast for an illustration point: the present-character rows,
 * sanitized for prompting, capped at SCENE_CAST_LIMIT and ordered by overall
 * prominence (sceneCount desc) so the leads are described first.
 */
async function loadPointCast(
  db: Db,
  bookId: string,
  characterIds: string[],
): Promise<CharacterForPrompt[]> {
  if (characterIds.length === 0) return [];
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      appearanceToken: characters.appearanceToken,
      profile: characters.profile,
    })
    .from(characters)
    .where(and(eq(characters.bookId, bookId), inArray(characters.id, characterIds)))
    .orderBy(desc(characters.sceneCount), asc(characters.createdAt));
  return rows.slice(0, SCENE_CAST_LIMIT).map((r) => ({
    name: r.name,
    appearanceToken: r.appearanceToken,
    profile: sanitizedProfile(r.profile),
  }));
}

interface ChapterRow {
  id: string;
  idx: number;
  title: string | null;
  text: string;
  wordCount: number | null;
}

/** Chapters in reading order, with the text + word count the planner needs. */
async function loadChapters(db: Db, bookId: string): Promise<ChapterRow[]> {
  return db
    .select({
      id: chapters.id,
      idx: chapters.idx,
      title: chapters.title,
      text: chapters.text,
      wordCount: chapters.wordCount,
    })
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.idx));
}

/** The planner's character roster: every character with an appearance token. */
async function loadRoster(db: Db, bookId: string): Promise<PlanRosterMember[]> {
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      aliases: characters.aliases,
      profile: characters.profile,
    })
    .from(characters)
    .where(and(eq(characters.bookId, bookId), isNotNull(characters.appearanceToken)))
    .orderBy(desc(characters.sceneCount), asc(characters.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: r.aliases,
    oneLine: sanitizedProfile(r.profile)?.oneLine ?? null,
  }));
}

/** Per kind+subject bookkeeping of what already exists in the images table. */
interface ExistingImages {
  done: Set<string>;
  maxVersion: Map<string, number>;
}

const subjectKey = (kind: ImageKind, subjectId: string): string => `${kind}:${subjectId}`;

async function loadExistingImages(db: Db, bookId: string): Promise<ExistingImages> {
  const rows = await db
    .select({
      kind: images.kind,
      subjectId: images.subjectId,
      status: images.status,
      version: images.version,
    })
    .from(images)
    .where(eq(images.bookId, bookId));
  const done = new Set<string>();
  const maxVersion = new Map<string, number>();
  for (const row of rows) {
    if (!row.subjectId) continue;
    const key = subjectKey(row.kind, row.subjectId);
    if (row.status === 'done') done.add(key);
    maxVersion.set(key, Math.max(maxVersion.get(key) ?? 0, row.version));
  }
  return { done, maxVersion };
}

/**
 * Rebuild semantics (Phase 0, full-run only): planning is idempotent by
 * destroy-and-recompute. We delete the book's existing illustration_points rows
 * AND its existing scene_storyboard images (DB rows + best-effort MinIO objects)
 * before planning, so a re-run produces a clean, current set rather than
 * accumulating stale points/frames keyed to old offsets. Portraits
 * (character_portrait) are deliberately NOT touched — character identity is
 * stable across re-illustration and portraits are expensive to redo.
 */
async function rebuildResetStoryboards(db: Db, bookId: string, log: (m: string) => void): Promise<void> {
  const storyboardRows = await db
    .select({
      id: images.id,
      objectKey: images.objectKey,
      thumbObjectKey: images.thumbObjectKey,
    })
    .from(images)
    .where(and(eq(images.bookId, bookId), eq(images.kind, 'scene_storyboard')));

  // Best-effort object cleanup: a missing/failed delete must not block the
  // rebuild (the DB row is the source of truth; orphaned objects are harmless).
  for (const row of storyboardRows) {
    for (const key of [row.objectKey, row.thumbObjectKey]) {
      if (!key) continue;
      try {
        await deleteObject('images', key);
      } catch (err) {
        log(`rebuild: failed to delete object ${key} (ignored): ${redactSecrets(String(err))}`);
      }
    }
  }

  await db
    .delete(images)
    .where(and(eq(images.bookId, bookId), eq(images.kind, 'scene_storyboard')));
  await db.delete(illustrationPoints).where(eq(illustrationPoints.bookId, bookId));

  log(
    `rebuild: cleared ${storyboardRows.length} storyboard image(s) and all prior illustration points`,
  );
}

/**
 * Phase 0 — plan illustration points for every narrative chapter. One LLM call
 * per surviving chapter; non-narrative chapters (front/back matter, promos) are
 * skipped via the heuristic pre-filter and get no points. Per-chapter failures
 * are logged and skipped; only a systemic LLM error (server gone / model
 * missing) aborts the whole stage. Returns nothing — points are persisted as we
 * go so a retry resumes from a clean rebuild.
 */
async function planIllustrationPoints(args: {
  db: Db;
  bookId: string;
  runId: string;
  book: { title: string; userId: string; llmProvider: string | null; llmModel: string | null };
  log: (m: string) => void;
}): Promise<void> {
  const { db, bookId, runId, book, log } = args;

  const llm: LLM = await resolveLlm(db, book);
  // The planner makes one LLM call per chapter; fail fast (with retries for a
  // momentary home-box blip) rather than discover the LLM is down on chapter 1.
  let health = { ok: false, detail: 'not checked' } as { ok: boolean; detail?: string };
  for (let attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt++) {
    health = await llm.healthCheck();
    if (health.ok) break;
    if (attempt < HEALTH_CHECK_ATTEMPTS) {
      log(`LLM health check attempt ${attempt} failed (${health.detail}); retrying`);
      await sleep(HEALTH_CHECK_BACKOFF_MS);
    }
  }
  if (!health.ok) {
    throw new Error(
      `imagine: LLM health check failed after ${HEALTH_CHECK_ATTEMPTS} attempts: ${health.detail}`,
    );
  }

  const roster = await loadRoster(db, bookId);
  const chapterRows = await loadChapters(db, bookId);

  // Idempotent rebuild: wipe prior points + storyboards before re-planning.
  await rebuildResetStoryboards(db, bookId, log);

  const total = chapterRows.length;
  let planned = 0;
  let pointCount = 0;

  let chapterIndex = 0;
  for (const chapter of chapterRows) {
    await reportProgress(runId, {
      stage: 'imagine',
      percent: (chapterIndex / Math.max(1, total)) * PLANNING_PERCENT_END,
      currentStep: `Planning illustrations (ch ${chapterIndex + 1}/${total})`,
    });
    chapterIndex++;

    if (isNonNarrative({ title: chapter.title, wordCount: chapter.wordCount ?? 0 })) {
      log(`chapter ${chapter.idx} ("${chapter.title ?? ''}") non-narrative — no points`);
      continue;
    }

    const maxMoments = imagesPerChapter(chapter.wordCount ?? 0);
    try {
      const result = await planChapterIllustrations({
        chapter: { id: chapter.id, text: chapter.text, title: chapter.title },
        roster,
        maxMoments,
        llm,
        bookTitle: book.title,
      });
      await incrementRunTokens(runId, result.tokensIn, result.tokensOut);

      if (result.points.length > 0) {
        await db.insert(illustrationPoints).values(
          result.points.map((p) => ({
            bookId,
            chapterId: chapter.id,
            idx: p.idx,
            charOffset: p.charOffset,
            anchorQuote: p.anchorQuote,
            momentDescription: p.momentDescription,
            presentCharacterIds: p.presentCharacterIds,
            score: p.score,
          })),
        );
      }
      planned++;
      pointCount += result.points.length;
      log(`chapter ${chapter.idx}: planned ${result.points.length}/${maxMoments} point(s)`);
    } catch (err) {
      if (!(err instanceof StructuredOutputError) && !(err instanceof OllamaError)) throw err;
      // Systemic LLM failure: every subsequent chapter would fail too — abort
      // and let BullMQ retry the stage (a fresh rebuild + re-plan).
      if (err instanceof OllamaError && err.code && SYSTEMIC_OLLAMA_CODES.has(err.code)) {
        throw new Error(`imagine: systemic LLM failure (${err.code}): ${err.message}`);
      }
      // A single hard chapter (bad structured output) must not block the book.
      log(`chapter ${chapter.idx} planning failed (skipped): ${redactSecrets(err.message)}`);
    }
  }

  log(`planning complete: ${pointCount} point(s) across ${planned}/${total} chapter(s)`);
}

/**
 * Imagine stage. Two phases:
 *
 * Phase 0 (full-run only) — plan illustration points: one LLM call per
 * narrative chapter picks the best N quote-anchored visual moments and persists
 * them to illustration_points (idempotent rebuild; see rebuildResetStoryboards).
 *
 * Phase 1 — generate: one image per significant character (portrait) and per
 * planned illustration point (storyboard frame), generated sequentially (one
 * GPU), encoded to webp (full + 384px thumb), stored in MinIO, and recorded in
 * the images table with full provenance.
 *
 * Resume-safe: subjects with a 'done' image of the same kind are skipped (after
 * a rebuild the points are fresh, so nothing is skipped). `only` targets a
 * single subject for regeneration — it skips Phase 0 entirely, never skips, and
 * writes the next version. For storyboards `only.subjectId` is an
 * illustration_points id.
 */
export async function runImagine(payload: ImagineJobPayload): Promise<void> {
  const { bookId, runId, only } = payload;
  const db = getDb();
  const log = (msg: string) => console.log(`[imagine ${bookId}] ${msg}`);

  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) throw new Error(`imagine: book ${bookId} not found`);

  // runId fence: a newer run supersedes this job. Bail before ANY write.
  if (await isRunSuperseded(bookId, runId)) {
    log(`run ${runId} superseded by a newer run; skipping`);
    return;
  }

  await setBookStatus(bookId, 'imagining');
  await reportProgress(runId, {
    stage: 'imagine',
    percent: 0,
    currentStep: only ? 'Regenerating illustration' : 'Planning illustrations',
  });

  // -------------------------------------------------------------------------
  // Phase 0 — plan illustration points (full run only; only-mode reuses the
  // points already planned by a prior full run).
  // -------------------------------------------------------------------------
  if (!only) {
    await planIllustrationPoints({ db, bookId, runId, book, log });
  }

  // Style preset: the book's pinned preset, else the built-in default.
  const style = book.stylePresetId
    ? await db.query.stylePresets.findFirst({ where: eq(stylePresets.id, book.stylePresetId) })
    : await db.query.stylePresets.findFirst({
        where: eq(stylePresets.slug, DEFAULT_STYLE_SLUG),
      });
  if (!style) {
    throw new Error(
      book.stylePresetId
        ? `imagine: style preset ${book.stylePresetId} not found`
        : `imagine: default style preset '${DEFAULT_STYLE_SLUG}' is missing — run db migrations`,
    );
  }
  const styleFragment = {
    promptFragment: style.promptFragment,
    negativeFragment: style.negativeFragment ?? '',
  };

  const imageGen: ImageGen = await resolveImageGen(db, book);
  // A home GPU box can be momentarily unreachable; retry before giving up so a
  // single blip doesn't fail a 100+ image run.
  let health = { ok: false, detail: 'not checked' } as { ok: boolean; detail?: string };
  for (let attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt++) {
    health = await imageGen.healthCheck();
    if (health.ok) break;
    if (attempt < HEALTH_CHECK_ATTEMPTS) {
      log(`health check attempt ${attempt} failed (${health.detail}); retrying`);
      await sleep(HEALTH_CHECK_BACKOFF_MS);
    }
  }
  if (!health.ok) {
    throw new Error(
      `imagine: ComfyUI health check failed after ${HEALTH_CHECK_ATTEMPTS} attempts: ${health.detail}`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1 work plan: portraits first (they anchor character identity), then
  // one storyboard per planned illustration point.
  // -------------------------------------------------------------------------
  const existing = await loadExistingImages(db, bookId);
  const nextVersion = (kind: ImageKind, subjectId: string): number =>
    (existing.maxVersion.get(subjectKey(kind, subjectId)) ?? 0) + 1;

  const portraitChars = await loadPortraitCharacters(db, bookId);
  const sceneRows = await loadAnalyzedScenes(db, bookId);
  const pointRows = await loadIllustrationPoints(db, bookId);

  const portraitItem = (c: PortraitCharacter, step: string): WorkItem => {
    const { prompt, negative } = buildPortraitPrompt({ character: c, style: styleFragment });
    return {
      kind: 'character_portrait',
      subjectId: c.id,
      version: nextVersion('character_portrait', c.id),
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      prompt,
      negative,
      step,
    };
  };

  // A storyboard item per illustration point: the moment description IS the key
  // visual moment, the setting/mood are borrowed from the analyzed scene
  // containing the point's offset, and the cast is the point's present
  // characters resolved to appearance tokens.
  const storyboardItem = async (point: IllustrationPointRow, step: string): Promise<WorkItem> => {
    const chapterScenes = sceneRows.filter((s) => s.chapterId === point.chapterId);
    const ctx = sceneContextForOffset(chapterScenes, point.charOffset);
    const cast = await loadPointCast(db, bookId, point.presentCharacterIds);
    const { prompt, negative } = buildScenePrompt({
      scene: {
        summary: point.momentDescription,
        setting: ctx.setting,
        timeOfDay: ctx.timeOfDay,
        mood: ctx.mood,
        keyVisualMoment: point.momentDescription,
      },
      characters: cast,
      style: styleFragment,
    });
    return {
      kind: 'scene_storyboard',
      subjectId: point.id,
      version: nextVersion('scene_storyboard', point.id),
      width: SCENE_WIDTH,
      height: SCENE_HEIGHT,
      prompt,
      negative,
      step,
    };
  };

  let plan: WorkItem[];
  if (only) {
    // Regeneration: exactly this subject, never skipped, next (or requested)
    // version.
    let item: WorkItem;
    if (only.kind === 'character_portrait') {
      const c = portraitChars.find((p) => p.id === only.subjectId);
      if (!c) {
        throw new Error(
          `imagine: character ${only.subjectId} not found or not portrait-eligible`,
        );
      }
      item = portraitItem(c, `Painting ${c.name}`);
    } else {
      const point = pointRows.find((p) => p.id === only.subjectId);
      if (!point) {
        throw new Error(
          `imagine: illustration point ${only.subjectId} not found (stale regenerate request?)`,
        );
      }
      item = await storyboardItem(point, 'Regenerating illustration');
    }
    item.version = only.version ?? item.version;
    plan = [item];
  } else {
    const portraits = portraitChars
      .filter((c) => !existing.done.has(subjectKey('character_portrait', c.id)))
      .map((c, i, arr) => portraitItem(c, `Painting ${c.name} (${i + 1}/${arr.length})`));
    const storyboardPoints = pointRows.filter(
      (p) => !existing.done.has(subjectKey('scene_storyboard', p.id)),
    );
    const storyboards: WorkItem[] = [];
    let moment = 0;
    for (const point of storyboardPoints) {
      moment++;
      storyboards.push(
        await storyboardItem(point, `Illustrating moment ${moment}/${storyboardPoints.length}`),
      );
    }
    plan = [...portraits, ...storyboards];
  }

  log(
    `plan: ${plan.filter((i) => i.kind === 'character_portrait').length} portraits + ` +
      `${plan.filter((i) => i.kind === 'scene_storyboard').length} storyboards` +
      (only ? ' (only-mode)' : ''),
  );

  // -------------------------------------------------------------------------
  // Generate sequentially (one GPU; concurrency is enforced at the worker).
  // Phase 1 owns the PLANNING_PERCENT_END..100 slice of the progress bar.
  // -------------------------------------------------------------------------
  const genStart = only ? 0 : PLANNING_PERCENT_END;
  const genSpan = 100 - genStart;
  let completed = 0;
  let attempted = 0;
  let failed = 0;
  let consecutiveSystemic = 0;

  for (const item of plan) {
    await reportProgress(runId, {
      stage: 'imagine',
      percent: genStart + (completed / Math.max(1, plan.length)) * genSpan,
      currentStep: item.step,
    });

    attempted++;
    try {
      // Retry transient ComfyUI blips (dropped connection / slow generation)
      // on the same image before treating it as a failure.
      let result;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await imageGen.generate({
            prompt: item.prompt,
            negative: item.negative,
            width: item.width,
            height: item.height,
          });
          break;
        } catch (genErr) {
          if (!isSystemicImageError(genErr) || attempt >= TRANSIENT_RETRY_ATTEMPTS) throw genErr;
          const backoff = TRANSIENT_BACKOFF_MS[attempt - 1] ?? 30_000;
          const code = isImageProviderError(genErr) ? genErr.code : undefined;
          log(
            `${item.kind} ${item.subjectId} transient error ` +
              `(${code}), retry ${attempt}/${TRANSIENT_RETRY_ATTEMPTS} in ${backoff}ms`,
          );
          await sleep(backoff);
        }
      }

      const webp = await sharp(result.png).webp({ quality: WEBP_QUALITY }).toBuffer();
      const thumb = await sharp(result.png)
        .resize({ width: THUMB_WIDTH })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();

      const base = `images/${bookId}/${item.kind}/${item.subjectId}/v${item.version}`;
      const objectKey = `${base}.webp`;
      const thumbObjectKey = `${base}.thumb.webp`;
      await putObject('images', objectKey, webp, 'image/webp');
      await putObject('images', thumbObjectKey, thumb, 'image/webp');

      await db.insert(images).values({
        bookId,
        kind: item.kind,
        subjectId: item.subjectId,
        prompt: item.prompt,
        negativePrompt: item.negative,
        provider: imageGen.provider,
        model: imageGen.model,
        seed: BigInt(result.seed),
        params: {
          steps: result.params.steps,
          cfg: result.params.cfg,
          width: result.width,
          height: result.height,
          workflow: WORKFLOW,
          durationMs: result.durationMs,
        },
        objectKey,
        thumbObjectKey,
        width: result.width,
        height: result.height,
        status: 'done',
        version: item.version,
      });
      consecutiveSystemic = 0;
      log(
        `${item.kind} ${item.subjectId} v${item.version} done ` +
          `(seed ${result.seed}, ${result.durationMs}ms)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Record the failure (best effort) so the UI can show it, then decide
      // whether the stage can keep going.
      try {
        await db.insert(images).values({
          bookId,
          kind: item.kind,
          subjectId: item.subjectId,
          prompt: item.prompt,
          negativePrompt: item.negative,
          provider: imageGen.provider,
          model: imageGen.model,
          params: { width: item.width, height: item.height, workflow: WORKFLOW },
          status: 'failed',
          error: redactSecrets(message),
          version: item.version,
        });
      } catch (recordErr) {
        console.error(`[imagine ${bookId}] failed to record image failure:`, recordErr);
      }

      // A systemic error here means the per-image retries above were already
      // exhausted. One image's worth of blips must not nuke a 100+ image run,
      // so only abort once several images fail back-to-back (server truly gone
      // or saturated); BullMQ then retries the stage, which resumes (done
      // images are skipped).
      if (isSystemicImageError(err)) {
        consecutiveSystemic++;
        failed++;
        log(
          `${item.kind} ${item.subjectId} v${item.version} systemic failure ` +
            `${consecutiveSystemic}/${CONSECUTIVE_SYSTEMIC_LIMIT}: ${message}`,
        );
        if (consecutiveSystemic >= CONSECUTIVE_SYSTEMIC_LIMIT) {
          throw new Error(
            `imagine: ${consecutiveSystemic} consecutive image-provider failures — ` +
              `aborting as systemic (last: ${redactSecrets(message)})`,
          );
        }
        completed++;
        continue;
      }
      // Unexpected (sharp/storage/db): not a per-image generation problem.
      if (!isImageProviderError(err)) throw err;

      failed++;
      log(`${item.kind} ${item.subjectId} v${item.version} failed: ${message}`);
      if (failed === attempted && attempted >= EARLY_FAILURE_WINDOW) {
        throw new Error(
          `imagine: first ${attempted} generations all failed — aborting as systemic ` +
            `(last error: ${redactSecrets(message)})`,
        );
      }
      // Otherwise: one bad prompt must never block the whole book.
    }
    completed++;
  }

  log(
    `complete: ${completed - failed}/${plan.length} images generated` +
      (failed > 0 ? `, ${failed} failed` : ''),
  );

  await reportProgress(runId, {
    stage: 'imagine',
    percent: 100,
    currentStep: 'Illustrations complete',
  });
  await setBookStatus(bookId, 'ready');
  await completeRun(runId);
}
