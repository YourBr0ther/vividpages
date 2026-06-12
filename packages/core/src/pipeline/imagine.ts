import { ComfyUIError, type ImageGen } from '@vividpages/ai';
import {
  books,
  characters,
  getDb,
  images,
  sceneCharacters,
  scenes,
  stylePresets,
  type Db,
  type ImageKind,
} from '@vividpages/db';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import sharp from 'sharp';

import { characterProfileSchema, type CharacterProfile } from '../analysis/profile-schema';
import { APPEARANCE_FIELD_ORDER, sanitizeTraitValue } from '../characters/appearance';
import {
  buildPortraitPrompt,
  buildScenePrompt,
  type CharacterForPrompt,
} from '../imaging/prompt';
import type { ImagineJobPayload } from '../queues';
import { putObject } from '../storage';
import { resolveImageGen } from './llm';
import { completeRun, isRunSuperseded, reportProgress, setBookStatus } from './progress';

/** ComfyUIError codes that mean the server is gone — no image can succeed. */
const SYSTEMIC_COMFYUI_CODES = new Set(['NETWORK', 'TIMEOUT']);

/** If the first this-many generations ALL fail, the failure is systemic. */
const EARLY_FAILURE_WINDOW = 5;

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
  globalIdx: number;
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
      globalIdx: scenes.globalIdx,
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

/**
 * sceneId -> up to SCENE_CAST_LIMIT present characters, ordered by overall
 * character prominence (sceneCount desc) so the leads are described first.
 */
async function loadSceneCasts(db: Db, bookId: string): Promise<Map<string, CharacterForPrompt[]>> {
  const rows = await db
    .select({
      sceneId: sceneCharacters.sceneId,
      name: characters.name,
      appearanceToken: characters.appearanceToken,
      profile: characters.profile,
    })
    .from(sceneCharacters)
    .innerJoin(scenes, eq(sceneCharacters.sceneId, scenes.id))
    .innerJoin(characters, eq(sceneCharacters.characterId, characters.id))
    .where(eq(scenes.bookId, bookId))
    .orderBy(desc(characters.sceneCount), asc(characters.createdAt));
  const bySceneId = new Map<string, CharacterForPrompt[]>();
  for (const row of rows) {
    const cast = bySceneId.get(row.sceneId) ?? [];
    if (cast.length >= SCENE_CAST_LIMIT) continue;
    cast.push({
      name: row.name,
      appearanceToken: row.appearanceToken,
      profile: sanitizedProfile(row.profile),
    });
    bySceneId.set(row.sceneId, cast);
  }
  return bySceneId;
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

function isSystemicImageError(err: unknown): boolean {
  return err instanceof ComfyUIError && SYSTEMIC_COMFYUI_CODES.has(err.code);
}

/**
 * Imagine stage: one image per significant character (portrait) and per
 * analyzed scene (storyboard frame), generated sequentially (one GPU),
 * encoded to webp (full + 384px thumb), stored in MinIO, and recorded in the
 * images table with full provenance (prompt, seed, params, duration).
 *
 * Resume-safe: subjects that already have a 'done' image of the same kind are
 * skipped. `only` targets a single subject for regeneration — it never skips,
 * and writes the next version.
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
    currentStep: 'Preparing illustrations',
  });

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
  const health = await imageGen.healthCheck();
  if (!health.ok) {
    throw new Error(`imagine: ComfyUI health check failed: ${health.detail}`);
  }

  // -------------------------------------------------------------------------
  // Work plan: portraits first (they anchor character identity), then scenes.
  // -------------------------------------------------------------------------
  const existing = await loadExistingImages(db, bookId);
  const nextVersion = (kind: ImageKind, subjectId: string): number =>
    (existing.maxVersion.get(subjectKey(kind, subjectId)) ?? 0) + 1;

  const portraitChars = await loadPortraitCharacters(db, bookId);
  const sceneRows = await loadAnalyzedScenes(db, bookId);
  const sceneCasts = await loadSceneCasts(db, bookId);
  const totalScenes = sceneRows.length;

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

  const sceneItem = (s: SceneRow): WorkItem => {
    const { prompt, negative } = buildScenePrompt({
      scene: s,
      characters: sceneCasts.get(s.id) ?? [],
      style: styleFragment,
    });
    return {
      kind: 'scene_storyboard',
      subjectId: s.id,
      version: nextVersion('scene_storyboard', s.id),
      width: SCENE_WIDTH,
      height: SCENE_HEIGHT,
      prompt,
      negative,
      step: `Illustrating scene ${s.globalIdx + 1}/${totalScenes}`,
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
      const s = sceneRows.find((row) => row.id === only.subjectId);
      if (!s) throw new Error(`imagine: analyzed scene ${only.subjectId} not found`);
      item = sceneItem(s);
    }
    item.version = only.version ?? item.version;
    plan = [item];
  } else {
    const portraits = portraitChars
      .filter((c) => !existing.done.has(subjectKey('character_portrait', c.id)))
      .map((c, i, arr) => portraitItem(c, `Painting ${c.name} (${i + 1}/${arr.length})`));
    const storyboards = sceneRows
      .filter((s) => !existing.done.has(subjectKey('scene_storyboard', s.id)))
      .map(sceneItem);
    plan = [...portraits, ...storyboards];
  }

  log(
    `plan: ${plan.filter((i) => i.kind === 'character_portrait').length} portraits + ` +
      `${plan.filter((i) => i.kind === 'scene_storyboard').length} scenes` +
      (only ? ' (only-mode)' : ''),
  );

  // -------------------------------------------------------------------------
  // Generate sequentially (one GPU; concurrency is enforced at the worker).
  // -------------------------------------------------------------------------
  let completed = 0;
  let attempted = 0;
  let failed = 0;

  for (const item of plan) {
    await reportProgress(runId, {
      stage: 'imagine',
      percent: (completed / Math.max(1, plan.length)) * 100,
      currentStep: item.step,
    });

    attempted++;
    try {
      const result = await imageGen.generate({
        prompt: item.prompt,
        negative: item.negative,
        width: item.width,
        height: item.height,
      });

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
          error: message,
          version: item.version,
        });
      } catch (recordErr) {
        console.error(`[imagine ${bookId}] failed to record image failure:`, recordErr);
      }

      // Systemic: the server is unreachable or saturated — every subsequent
      // image would fail too, so abort and let BullMQ retry the stage.
      if (isSystemicImageError(err)) {
        throw new Error(
          `imagine: systemic ComfyUI failure (${(err as ComfyUIError).code}): ${message}`,
        );
      }
      // Unexpected (sharp/storage/db): not a per-image generation problem.
      if (!(err instanceof ComfyUIError)) throw err;

      failed++;
      log(`${item.kind} ${item.subjectId} v${item.version} failed: ${message}`);
      if (failed === attempted && attempted >= EARLY_FAILURE_WINDOW) {
        throw new Error(
          `imagine: first ${attempted} generations all failed — aborting as systemic ` +
            `(last error: ${message})`,
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
