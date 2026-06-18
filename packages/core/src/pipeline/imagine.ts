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
  sceneCharacters,
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
import { isOnlySet } from '../queues';
import { redactSecrets } from '../redact';
import { deleteObject, putObject } from '../storage';
import { getEnv } from '../env';
import { runWithConcurrency, type Outcome } from './concurrency';
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
const PORTRAIT_ROLES = new Set(['main']);

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
  /**
   * LoRAs to chain into this image's graph (issue #2). Empty → no graph
   * surgery and byte-identical to the no-LoRA path.
   */
  loras: ResolvedLora[];
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

/**
 * A character's optional LoRA chain config (issue #2). loraName null → no LoRA.
 * `loraKeyword` lives on CharacterForPrompt (it feeds the prompt builder), so it
 * is not duplicated here.
 */
interface CharacterLora {
  loraName: string | null;
  loraStrength: number | null;
}

interface PortraitCharacter extends CharacterForPrompt, CharacterLora {
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
      loraName: characters.loraName,
      loraKeyword: characters.loraKeyword,
      loraStrength: characters.loraStrength,
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
      loraName: r.loraName,
      loraKeyword: r.loraKeyword,
      loraStrength: r.loraStrength,
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
  sceneType: string | null;
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
      sceneType: scenes.sceneType,
      keyVisualMoment: scenes.keyVisualMoment,
    })
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.analysisStatus, 'done')))
    .orderBy(asc(scenes.globalIdx));
}

/** Setting/mood/timeOfDay/sceneType borrowed from an analyzed scene for a point's prompt. */
export interface SceneContext {
  setting: string | null;
  timeOfDay: string | null;
  mood: string | null;
  sceneType: string | null;
}

const EMPTY_SCENE_CONTEXT: SceneContext = {
  setting: null,
  timeOfDay: null,
  mood: null,
  sceneType: null,
};

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
    sceneType: string | null;
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
  return {
    setting: src.setting,
    timeOfDay: src.timeOfDay,
    mood: src.mood,
    sceneType: src.sceneType,
  };
}

/**
 * A scene reduced to the fields needed to derive a fallback illustration point.
 * `startOffset` is already a paragraph-start char offset into the chapter text.
 */
export interface FallbackScene {
  startOffset: number;
  keyVisualMoment: string | null;
  summary: string | null;
  /** Resolved roster character ids present in the scene. */
  presentCharacterIds: string[];
}

/** A scene-derived fallback point (the same shape persisted for LLM points). */
export interface FallbackPoint {
  idx: number;
  charOffset: number;
  anchorQuote: string;
  momentDescription: string;
  presentCharacterIds: string[];
  score: number;
}

/** Low default score for scene-derived points (LLM importance is 1–5). */
const SCENE_FALLBACK_SCORE = 1;

/**
 * Builds up to `maxMoments` illustration points from a chapter's analyzed
 * scenes, used when the LLM planner returns ZERO points for a narrative chapter
 * so the chapter still gets art. Pure (no IO) and unit-tested.
 *
 * Each point's `momentDescription` is the scene's `keyVisualMoment` (else its
 * `summary`); scenes with neither are dropped. `charOffset` is the scene's
 * paragraph-start `startOffset`; `presentCharacterIds` are the scene's resolved
 * characters; `score` is a low default. When there are more usable scenes than
 * `maxMoments` the selection is spread evenly across them (endpoints kept);
 * with fewer, every usable scene is used. Points get contiguous `idx` sorted by
 * `charOffset`. Uses NO LLM call.
 */
export function sceneFallbackPoints(
  scenes: FallbackScene[],
  maxMoments: number,
): FallbackPoint[] {
  const usable = scenes
    .map((s) => ({ ...s, desc: s.keyVisualMoment ?? s.summary }))
    .filter((s): s is FallbackScene & { desc: string } => s.desc != null && s.desc.length > 0);
  if (usable.length === 0 || maxMoments <= 0) return [];

  // Evenly spread the selection when there are more scenes than slots; keep the
  // endpoints. Otherwise use every usable scene.
  let selected: Array<FallbackScene & { desc: string }>;
  if (usable.length <= maxMoments) {
    selected = usable;
  } else if (maxMoments === 1) {
    selected = [usable[0] as FallbackScene & { desc: string }];
  } else {
    const picked = new Set<number>();
    for (let i = 0; i < maxMoments; i++) {
      picked.add(Math.round((i / (maxMoments - 1)) * (usable.length - 1)));
    }
    selected = [...picked].sort((a, b) => a - b).map((i) => usable[i] as FallbackScene & { desc: string });
  }

  return selected
    .slice()
    .sort((a, b) => a.startOffset - b.startOffset)
    .map((s, idx) => ({
      idx,
      charOffset: s.startOffset,
      anchorQuote: '',
      momentDescription: s.desc,
      presentCharacterIds: s.presentCharacterIds,
      score: SCENE_FALLBACK_SCORE,
    }));
}

interface IllustrationPointRow {
  id: string;
  chapterId: string;
  idx: number;
  charOffset: number;
  momentDescription: string;
  presentCharacterIds: string[];
  /** LLM importance rank (1–5), when known; tightens 1–2 character framing. */
  score: number | null;
}

/**
 * Builds the only-SET storyboard work plan: maps each requested `subjectId` to
 * its illustration point and the next version to render (max+1 via
 * `maxVersionFor`). subjectIds order is preserved, duplicates collapse to one
 * item, and an unknown id throws (a stale regenerate request must fail loudly
 * rather than silently drop a scene). Pure (no IO), unit-tested.
 */
export function planOnlyStoryboardSet<T extends { id: string }>(
  pointRows: T[],
  subjectIds: string[],
  maxVersionFor: (subjectId: string) => number,
): Array<{ point: T; version: number }> {
  const byId = new Map(pointRows.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const plan: Array<{ point: T; version: number }> = [];
  for (const id of subjectIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const point = byId.get(id);
    if (!point) {
      throw new Error(
        `imagine: illustration point ${id} not found (stale regenerate request?)`,
      );
    }
    plan.push({ point, version: maxVersionFor(id) + 1 });
  }
  return plan;
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
      score: illustrationPoints.score,
    })
    .from(illustrationPoints)
    .where(eq(illustrationPoints.bookId, bookId))
    .orderBy(asc(illustrationPoints.chapterId), asc(illustrationPoints.idx));
}

/** A scene-cast member: prompt fields + optional LoRA config (issue #2). */
interface CastMember extends CharacterForPrompt, CharacterLora {}

/**
 * Loads the prompt cast for an illustration point: the present-character rows,
 * sanitized for prompting, capped at SCENE_CAST_LIMIT and ordered by overall
 * prominence (sceneCount desc) so the leads are described first. Carries each
 * member's optional LoRA config (name/keyword/strength) for chain assembly.
 */
async function loadPointCast(
  db: Db,
  bookId: string,
  characterIds: string[],
): Promise<CastMember[]> {
  if (characterIds.length === 0) return [];
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      appearanceToken: characters.appearanceToken,
      profile: characters.profile,
      loraName: characters.loraName,
      loraKeyword: characters.loraKeyword,
      loraStrength: characters.loraStrength,
    })
    .from(characters)
    .where(and(eq(characters.bookId, bookId), inArray(characters.id, characterIds)))
    .orderBy(desc(characters.sceneCount), asc(characters.createdAt));
  return rows.slice(0, SCENE_CAST_LIMIT).map((r) => ({
    name: r.name,
    appearanceToken: r.appearanceToken,
    profile: sanitizedProfile(r.profile),
    loraName: r.loraName,
    loraKeyword: r.loraKeyword,
    loraStrength: r.loraStrength,
  }));
}

/** Default LoRA strength when a character pins a LoRA but no strength. */
const DEFAULT_LORA_STRENGTH = 1.0;
/** Max distinct LoRAs chained onto one scene (VRAM/quality guard). */
const SCENE_LORA_CHAIN_LIMIT = 3;

/** One resolved LoRA destined for the adapter + provenance. */
interface ResolvedLora {
  name: string;
  strengthModel: number;
  strengthClip: number;
}

/**
 * Maps a character's LoRA config to a single `ResolvedLora`, or null when the
 * character has no LoRA (`loraName` unset). Strength defaults to
 * DEFAULT_LORA_STRENGTH and applies to both model+clip (single-strength model).
 * Pure (no IO), unit-testable.
 */
export function resolveCharacterLora(c: {
  loraName: string | null;
  loraStrength: number | null;
}): ResolvedLora | null {
  const name = c.loraName?.trim();
  if (!name) return null;
  const s = c.loraStrength ?? DEFAULT_LORA_STRENGTH;
  return { name, strengthModel: s, strengthClip: s };
}

/**
 * Assembles the scene LoRA chain from the present cast (already capped at
 * SCENE_CAST_LIMIT and ordered by prominence): collects each member's LoRA,
 * **dedupes by name** (same LoRA used once, first occurrence's strength wins),
 * and caps the chain at SCENE_LORA_CHAIN_LIMIT keeping the most-prominent. When
 * distinct LoRAs exceed the cap the dropped names are reported via `onDrop`
 * (their prompt description still stands). Pure (no IO), unit-testable.
 */
export function assembleSceneLoras(
  cast: Array<{ loraName: string | null; loraStrength: number | null }>,
  onDrop?: (droppedNames: string[]) => void,
): ResolvedLora[] {
  const seen = new Set<string>();
  const distinct: ResolvedLora[] = [];
  for (const member of cast) {
    const lora = resolveCharacterLora(member);
    if (!lora || seen.has(lora.name)) continue;
    seen.add(lora.name);
    distinct.push(lora);
  }
  if (distinct.length <= SCENE_LORA_CHAIN_LIMIT) return distinct;
  const kept = distinct.slice(0, SCENE_LORA_CHAIN_LIMIT);
  const dropped = distinct.slice(SCENE_LORA_CHAIN_LIMIT).map((l) => l.name);
  onDrop?.(dropped);
  return kept;
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

/**
 * Per-chapter analyzed scenes (with their resolved present-character ids) used
 * to derive fallback illustration points when the planner returns zero. Keyed
 * by chapterId, scenes in reading order (globalIdx asc). Only 'done' scenes.
 */
async function loadFallbackScenesByChapter(
  db: Db,
  bookId: string,
): Promise<Map<string, FallbackScene[]>> {
  const sceneRows = await db
    .select({
      id: scenes.id,
      chapterId: scenes.chapterId,
      globalIdx: scenes.globalIdx,
      startOffset: scenes.startOffset,
      summary: scenes.summary,
      keyVisualMoment: scenes.keyVisualMoment,
    })
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.analysisStatus, 'done')))
    .orderBy(asc(scenes.globalIdx));

  const sceneIds = sceneRows.map((s) => s.id);
  const charsBySceneId = new Map<string, string[]>();
  if (sceneIds.length > 0) {
    const links = await db
      .select({ sceneId: sceneCharacters.sceneId, characterId: sceneCharacters.characterId })
      .from(sceneCharacters)
      .where(inArray(sceneCharacters.sceneId, sceneIds));
    for (const link of links) {
      const list = charsBySceneId.get(link.sceneId) ?? [];
      list.push(link.characterId);
      charsBySceneId.set(link.sceneId, list);
    }
  }

  const byChapter = new Map<string, FallbackScene[]>();
  for (const s of sceneRows) {
    const list = byChapter.get(s.chapterId) ?? [];
    list.push({
      startOffset: s.startOffset,
      keyVisualMoment: s.keyVisualMoment,
      summary: s.summary,
      presentCharacterIds: charsBySceneId.get(s.id) ?? [],
    });
    byChapter.set(s.chapterId, list);
  }
  return byChapter;
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
 * Phase 0 re-plan gating decision (pure, unit-testable).
 *
 * A "Generate art" run does a destructive rebuild (delete old points +
 * storyboards) then re-plans with the LLM, which is nondeterministic. On a
 * transient mid-Phase-1 failure BullMQ retries the SAME job/runId — if Phase 0
 * rebuilt again it would wipe the already-`done` storyboards and produce a
 * DIFFERENT set of point ids, defeating Phase 1's resume-skip. So we stamp each
 * planned point with its run's id and gate the rebuild on it:
 *
 *  - No existing points → fresh run → re-plan (true).
 *  - Any existing point whose runId !== this run's id → the points belong to an
 *    older "Generate art" run (or pre-date the stamp / are null) → this is a
 *    genuinely fresh run → rebuild + re-plan (true).
 *  - Every existing point already carries THIS runId → Phase 0 completed for
 *    this run and we are on a retry → skip the rebuild + re-plan, jump straight
 *    to Phase 1 which resumes against the stable point ids (false).
 */
export function shouldReplan(
  existingPoints: Array<{ runId: string | null }>,
  runId: string,
): boolean {
  if (existingPoints.length === 0) return true;
  return existingPoints.some((p) => p.runId !== runId);
}

/** Existing illustration points for the book, just the rebuild-gating fields. */
async function loadExistingPointStamps(
  db: Db,
  bookId: string,
): Promise<Array<{ id: string; runId: string | null }>> {
  return db
    .select({ id: illustrationPoints.id, runId: illustrationPoints.runId })
    .from(illustrationPoints)
    .where(eq(illustrationPoints.bookId, bookId));
}

/**
 * Phase 0 — plan illustration points for every narrative chapter. One LLM call
 * per surviving chapter; non-narrative chapters (front/back matter, promos) are
 * skipped via the heuristic pre-filter and get no points. Per-chapter failures
 * are logged and skipped; only a systemic LLM error (server gone / model
 * missing) aborts the whole stage. Points are persisted per-chapter (committed
 * incrementally) and stamped with this run's id, so a later-chapter abort keeps
 * the earlier chapters' points and a retry of this run resumes (via the
 * shouldReplan gate) instead of re-planning.
 *
 * Accepted destructive window: the rebuild deletes the old points + storyboards
 * BEFORE planning (a rebuild inherently replaces). If a systemic LLM failure
 * aborts before ANY chapter's points are inserted, the book is left with no art
 * and no points (status stays 'imagining'); BullMQ then retries, which — with
 * zero points persisted — re-plans from scratch. This is the accepted
 * "rebuild in progress" window; we deliberately do NOT wrap the whole book in a
 * transaction.
 */
async function planIllustrationPoints(args: {
  db: Db;
  bookId: string;
  runId: string;
  book: {
    title: string;
    userId: string;
    llmProvider: string | null;
    llmModel: string | null;
    matureContent: boolean;
  };
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
  // Analyzed scenes per chapter — the safety net when the planner returns zero.
  const fallbackScenesByChapter = await loadFallbackScenesByChapter(db, bookId);

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
        mature: book.matureContent,
      });
      await incrementRunTokens(runId, result.tokensIn, result.tokensOut);

      // Robust invariant: a narrative chapter must never be left unillustrated.
      // If the LLM returned zero moments (e.g. it returned isNarrative true with
      // an empty array for a long/truncated chapter), derive points from the
      // chapter's analyzed scenes — no extra LLM call. Degrades gracefully to
      // the old per-scene behavior for just this chapter.
      let points = result.points;
      if (points.length === 0) {
        const fallback = sceneFallbackPoints(
          fallbackScenesByChapter.get(chapter.id) ?? [],
          maxMoments,
        );
        if (fallback.length > 0) {
          log(
            `chapter ${chapter.idx}: planner returned 0 points; ` +
              `fell back to ${fallback.length} scene-derived point(s)`,
          );
          points = fallback;
        }
      }

      if (points.length > 0) {
        // Insert per-chapter, committed incrementally: a later chapter's failure
        // leaves earlier chapters' points persisted (stamped with this runId), so
        // a retry of this run resumes via the shouldReplan gate rather than
        // re-planning. Each point carries runId so Phase 0 can tell a retry of
        // THIS run from a genuinely fresh "Generate art" run.
        await db.insert(illustrationPoints).values(
          points.map((p) => ({
            bookId,
            chapterId: chapter.id,
            runId,
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
      pointCount += points.length;
      log(`chapter ${chapter.idx}: planned ${points.length}/${maxMoments} point(s)`);
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

/** Shared context for a single Phase-1 work item (carried into the pool). */
interface WorkItemContext {
  db: Db;
  imageGen: ImageGen;
  bookId: string;
  log: (m: string) => void;
}

/**
 * Generates, post-processes, stores and records ONE work item. Behavior is
 * identical to the old sequential body for a single item:
 *
 *  - Transient ComfyUI blips retry in-place (TRANSIENT_RETRY_ATTEMPTS with
 *    TRANSIENT_BACKOFF_MS) before counting as a failure.
 *  - Success: sharp webp + 384px thumb → MinIO ×2 → `images` insert → 'done'.
 *  - A systemic image-provider error (retries exhausted on NETWORK/TIMEOUT)
 *    records a 'failed' row and returns 'systemic' so the pool's shared
 *    consecutive counter can decide whether the run is doomed.
 *  - A non-systemic image-provider error (e.g. a bad prompt) records a 'failed'
 *    row and returns 'failed' — one bad item never blocks the book.
 *  - A truly-unexpected non-provider error (sharp/storage/db) records a best-
 *    effort 'failed' row, then RETHROWS (the pool surfaces it via onError).
 *
 * Returns the item's Outcome; never used for ordering (completion order varies).
 */
async function processWorkItem(item: WorkItem, ctx: WorkItemContext): Promise<Outcome> {
  const { db, imageGen, bookId, log } = ctx;
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
          // Empty → adapter returns a byte-identical no-LoRA graph.
          loras: item.loras,
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
        // Provenance (issue #2): the LoRAs actually applied. Omitted when none
        // so no-LoRA rows are unchanged.
        ...(item.loras.length > 0
          ? { loras: item.loras.map((l) => ({ name: l.name, strength: l.strengthModel })) }
          : {}),
      },
      objectKey,
      thumbObjectKey,
      width: result.width,
      height: result.height,
      status: 'done',
      version: item.version,
    });
    log(
      `${item.kind} ${item.subjectId} v${item.version} done ` +
        `(seed ${result.seed}, ${result.durationMs}ms)`,
    );
    return 'done';
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
    // exhausted. One image's worth of blips must not nuke a 100+ image run, so
    // the pool only aborts once several items return 'systemic' back-to-back
    // (server truly gone or saturated); BullMQ then retries the stage, which
    // resumes (done images are skipped).
    if (isSystemicImageError(err)) {
      log(`${item.kind} ${item.subjectId} v${item.version} systemic failure: ${message}`);
      return 'systemic';
    }
    // Unexpected (sharp/storage/db): not a per-image generation problem — let
    // the pool surface it (onError rethrows) so the stage fails loudly.
    if (!isImageProviderError(err)) throw err;

    // A non-systemic provider error (e.g. a bad prompt) must never block the
    // whole book; record it and move on.
    log(`${item.kind} ${item.subjectId} v${item.version} failed: ${message}`);
    return 'failed';
  }
}

/**
 * Imagine stage. Two phases:
 *
 * Phase 0 (full-run only) — plan illustration points: one LLM call per
 * narrative chapter picks the best N quote-anchored visual moments and persists
 * them to illustration_points (idempotent rebuild; see rebuildResetStoryboards).
 * Run-stamped (see shouldReplan): a fresh "Generate art" run rebuilds + re-plans
 * once; a BullMQ retry of the same runId skips Phase 0 and resumes Phase 1.
 *
 * Phase 1 — generate: one image per significant character (portrait) and per
 * planned illustration point (storyboard frame), encoded to webp (full + 384px
 * thumb), stored in MinIO, and recorded in the images table with full
 * provenance. Items run through a bounded-concurrency pool (issue #4,
 * WORKER_IMAGINE_INFLIGHT, default 2) so the GPU isn't idle between renders —
 * the GPU still serializes rendering; the window just removes our own
 * post-processing idle gaps. The SET of images produced is identical to the
 * old sequential loop; only completion order may vary.
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
  //
  // Run-stamping makes the destructive rebuild + nondeterministic re-plan run
  // ONCE per "Generate art" run. On a BullMQ retry of this same runId (e.g. a
  // transient ComfyUI blip mid-Phase-1), every existing point already carries
  // this runId, so we SKIP Phase 0 entirely and fall through to Phase 1, which
  // resume-skips the storyboards already 'done' (by stable point id) and only
  // regenerates the missing ones.
  // -------------------------------------------------------------------------
  if (!only) {
    const existingPoints = await loadExistingPointStamps(db, bookId);
    if (shouldReplan(existingPoints, runId)) {
      await planIllustrationPoints({ db, bookId, runId, book, log });
    } else {
      log(
        `Phase 0 skipped: all ${existingPoints.length} illustration point(s) ` +
          `carry this run's id (${runId}) — retry resumes Phase 1`,
      );
    }
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
    const { prompt, negative } = buildPortraitPrompt({
      character: {
        name: c.name,
        appearanceToken: c.appearanceToken,
        profile: c.profile,
        loraKeyword: c.loraKeyword,
      },
      style: styleFragment,
      mature: book.matureContent,
    });
    // The one character's LoRA (if any); empty → no surgery, byte-identical.
    const lora = resolveCharacterLora(c);
    return {
      kind: 'character_portrait',
      subjectId: c.id,
      version: nextVersion('character_portrait', c.id),
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      prompt,
      negative,
      loras: lora ? [lora] : [],
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
      // CastMember extends CharacterForPrompt, so loraKeyword flows through to
      // be woven into each member's clause.
      scene: {
        summary: point.momentDescription,
        setting: ctx.setting,
        timeOfDay: ctx.timeOfDay,
        mood: ctx.mood,
        sceneType: ctx.sceneType,
        keyVisualMoment: point.momentDescription,
      },
      characters: cast,
      style: styleFragment,
      mature: book.matureContent,
      // Importance pulls a tight 1–2 character beat slightly tighter still.
      importance: point.score,
    });
    // Scene LoRA chain: present cast's LoRAs, deduped by name, capped; dropped
    // names are logged (their prompt description still stands).
    const loras = assembleSceneLoras(cast, (dropped) =>
      log(
        `point ${point.id}: dropped ${dropped.length} LoRA(s) from the scene chain ` +
          `(cap ${SCENE_LORA_CHAIN_LIMIT}): ${dropped.join(', ')}`,
      ),
    );
    return {
      kind: 'scene_storyboard',
      subjectId: point.id,
      version: nextVersion('scene_storyboard', point.id),
      width: SCENE_WIDTH,
      height: SCENE_HEIGHT,
      prompt,
      negative,
      loras,
      step,
    };
  };

  let plan: WorkItem[];
  if (only && isOnlySet(only)) {
    // Regeneration of a SET of storyboard points (e.g. every scene affected by a
    // character merge). Each point gets its own next version (max+1); never
    // skipped. The pure planner validates ids + computes versions; we then build
    // the storyboard work items in that order.
    const set = planOnlyStoryboardSet(pointRows, only.subjectIds, (id) =>
      existing.maxVersion.get(subjectKey('scene_storyboard', id)) ?? 0,
    );
    const items: WorkItem[] = [];
    let moment = 0;
    for (const { point, version } of set) {
      moment++;
      const item = await storyboardItem(point, `Regenerating illustration ${moment}/${set.length}`);
      item.version = version;
      items.push(item);
    }
    plan = items;
  } else if (only) {
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
  // Generate through a bounded-concurrency pool (issue #4). The GPU still
  // serializes rendering — a small in-flight window just keeps the next prompt
  // queued in ComfyUI so the GPU isn't idle while a finished sibling
  // post-processes (sharp + uploads + DB write) on our side. Phase 1 owns the
  // PLANNING_PERCENT_END..100 slice of the progress bar.
  //
  // The hardening that was inline in the old sequential loop is preserved, now
  // driven off SHARED counters updated as tasks settle (completion order
  // varies; counts are order-independent):
  //  - consecutiveSystemic: ++ on 'systemic', reset to 0 on 'done'; at
  //    CONSECUTIVE_SYSTEMIC_LIMIT the run is doomed → set `aborted`.
  //  - early-failure: if attempted ≤ EARLY_FAILURE_WINDOW and every attempted
  //    item failed, the run is doomed → set `aborted`.
  // `aborted` stops launching NEW items; in-flight tasks drain; then we throw
  // the same systemic Error as before (BullMQ retries → run-stamping resumes,
  // skipping done images).
  // -------------------------------------------------------------------------
  const total = plan.length;
  const genStart = only ? 0 : PLANNING_PERCENT_END;
  const genSpan = 100 - genStart;
  // A single-subject regen has one item (depth is moot); a set regen and a full
  // run both use the bounded-concurrency window.
  const depth = only && !isOnlySet(only) ? 1 : getEnv().WORKER_IMAGINE_INFLIGHT;

  let completed = 0;
  let attempted = 0;
  let failed = 0;
  let consecutiveSystemic = 0;
  let aborted = false;
  /** The systemic Error to throw after the pool drains (set when aborting). */
  let abortError: Error | undefined;
  /** A truly-unexpected non-provider error from a task (rethrown after drain). */
  let unexpectedError: unknown;

  const ctx: WorkItemContext = { db, imageGen, bookId, log };
  /** In-flight progress reports; drained before the final 100% so a late one
   * can't land after it. */
  const progressReports: Array<Promise<void>> = [];

  await runWithConcurrency<WorkItem>(plan, depth, (item) => processWorkItem(item, ctx), {
    onOutcome: (outcome) => {
      attempted++;
      if (outcome === 'done') {
        completed++;
        consecutiveSystemic = 0;
      } else if (outcome === 'systemic') {
        // A 'systemic' item already recorded its 'failed' row and exhausted its
        // own transient retries; it counts toward completion (we move past it)
        // but feeds the consecutive-systemic doom counter.
        completed++;
        failed++;
        consecutiveSystemic++;
        log(`systemic failure ${consecutiveSystemic}/${CONSECUTIVE_SYSTEMIC_LIMIT}`);
        if (consecutiveSystemic >= CONSECUTIVE_SYSTEMIC_LIMIT && !aborted) {
          aborted = true;
          abortError = new Error(
            `imagine: ${consecutiveSystemic} consecutive image-provider failures — ` +
              `aborting as systemic`,
          );
        }
      } else {
        // 'failed' — a non-systemic provider error (bad prompt). It recorded a
        // 'failed' row; we move past it (completed++) so one bad item never
        // blocks the book.
        completed++;
        failed++;
        if (failed === attempted && attempted >= EARLY_FAILURE_WINDOW && !aborted) {
          aborted = true;
          abortError = new Error(
            `imagine: first ${attempted} generations all failed — aborting as systemic`,
          );
        }
      }
      // Order-independent progress: how many of the plan have settled.
      progressReports.push(
        reportProgress(runId, {
          stage: 'imagine',
          percent: genStart + (completed / Math.max(1, total)) * genSpan,
          currentStep: only
            ? `Regenerating illustrations (${completed}/${total})`
            : `Illustrating images (${completed}/${total})`,
        }),
      );
    },
    shouldAbort: () => aborted,
    onError: (err) => {
      // processWorkItem only rethrows truly-unexpected non-provider errors
      // (sharp/storage/db). Capture the first and abort the pool; rethrow after
      // it drains so the stage fails loudly (no resume-skip benefit here).
      if (unexpectedError === undefined) unexpectedError = err;
      aborted = true;
    },
  });

  // Settle any pending progress writes so a late one can't overwrite the final
  // 100% below (best-effort: a failed progress write must not fail the stage).
  await Promise.allSettled(progressReports);

  if (unexpectedError !== undefined) throw unexpectedError;
  if (abortError) throw abortError;

  log(
    `complete: ${completed - failed}/${total} images generated` +
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
