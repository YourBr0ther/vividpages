import { OllamaError, StructuredOutputError, completeStructured, type LLM } from '@vividpages/ai';
import {
  books,
  chapters,
  characters,
  getDb,
  sceneCharacters,
  scenes,
  type Db,
} from '@vividpages/db';
import { and, asc, eq, isNotNull, notInArray, sql } from 'drizzle-orm';

import { buildSceneAnalysisPrompt, type RosterEntry } from '../analysis/prompt';
import { candidateNames, findRosterMatch, splitCompoundName } from '../analysis/roster';
import { sceneAnalysisSchema, type SceneAnalysis } from '../analysis/schema';
import { getQueue, type StageJobPayload } from '../queues';
import { redactSecrets } from '../redact';
import { resolveLlm } from './llm';
import { incrementRunTokens, isRunSuperseded, reportProgress, setBookStatus } from './progress';

/** OllamaError codes that indicate the whole stage cannot succeed. */
const SYSTEMIC_OLLAMA_CODES = new Set(['NETWORK', 'TIMEOUT', 'MODEL_NOT_FOUND']);

/**
 * If more than half of this many initially-processed scenes fail, the
 * failure is treated as systemic and the stage aborts.
 */
const EARLY_FAILURE_WINDOW = 10;

interface CharacterRosterEntry extends RosterEntry {
  id: string;
}

/**
 * Builds the in-memory roster from existing character rows (resume support).
 * oneLineDesc prefers profile.oneLine, then the earliest descriptionDelta
 * recorded for the character.
 */
async function loadRoster(db: Db, bookId: string): Promise<CharacterRosterEntry[]> {
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      aliases: characters.aliases,
      profile: characters.profile,
    })
    .from(characters)
    .where(eq(characters.bookId, bookId));
  if (rows.length === 0) return [];

  const firstDelta = new Map<string, string>();
  const deltas = await db
    .select({
      characterId: sceneCharacters.characterId,
      delta: sceneCharacters.descriptionDelta,
    })
    .from(sceneCharacters)
    .innerJoin(scenes, eq(sceneCharacters.sceneId, scenes.id))
    .where(and(eq(scenes.bookId, bookId), isNotNull(sceneCharacters.descriptionDelta)))
    .orderBy(asc(scenes.globalIdx));
  for (const d of deltas) {
    if (d.delta && !firstDelta.has(d.characterId)) firstDelta.set(d.characterId, d.delta);
  }

  return rows.map((row) => {
    const profileOneLine =
      row.profile && typeof row.profile === 'object' && 'oneLine' in row.profile
        ? (row.profile as { oneLine?: unknown }).oneLine
        : undefined;
    return {
      id: row.id,
      name: row.name,
      aliases: row.aliases,
      oneLineDesc:
        typeof profileOneLine === 'string' ? profileOneLine : (firstDelta.get(row.id) ?? null),
    };
  });
}

/**
 * Writes one scene's analysis: scene columns + character/link rows.
 *
 * All writes for the scene run in one transaction so a crash can never leave
 * a partial scene behind (e.g. a scene_characters link inserted but its
 * character's sceneCount not yet incremented, which would undercount forever).
 *
 * The shared in-memory roster is only mutated AFTER the transaction commits:
 * a rollback must not leave phantom roster entries (whose ids no longer
 * exist) or description updates behind for subsequent scenes to match on.
 */
async function persistSceneAnalysis(
  db: Db,
  args: {
    bookId: string;
    sceneId: string;
    analysis: SceneAnalysis;
    roster: CharacterRosterEntry[];
  },
): Promise<void> {
  const { bookId, sceneId, analysis, roster } = args;

  // Staged roster mutations, applied only on successful commit.
  const newEntries: CharacterRosterEntry[] = [];
  const descUpdates = new Map<CharacterRosterEntry, string>();

  await db.transaction(async (tx) => {
    // Re-analysis can resolve differently (or the tx may be retried); start
    // each attempt with clean staging so nothing leaks between attempts.
    newEntries.length = 0;
    descUpdates.clear();

    const linkedCharacterIds = new Set<string>();
    for (const reported of analysis.characters) {
      // 'Trystan (The Villain)' should match either 'Trystan' or 'The Villain'.
      const names = candidateNames(reported.name);
      if (names.length === 0) continue;
      const mentionName = names[0]!;

      let entry: CharacterRosterEntry | undefined;
      for (const candidate of names) {
        // Same-scene repeats must also match entries created in THIS tx,
        // which are not yet visible in the shared roster.
        entry = findRosterMatch(roster, candidate) ?? findRosterMatch(newEntries, candidate);
        if (entry) break;
      }
      if (!entry) {
        // Pick the fragment that looks like a personal name as the display
        // name ('The Villain (Trystan)' -> 'Trystan'); the other fragments
        // become aliases so later mentions of either half match.
        const { name, aliases } = splitCompoundName(reported.name);
        const inserted = await tx
          .insert(characters)
          .values({ bookId, name, aliases, sceneCount: 0 })
          .returning({ id: characters.id });
        entry = { id: inserted[0]!.id, name, aliases, oneLineDesc: null };
        newEntries.push(entry);
      }
      // The model occasionally lists the same person twice under different
      // epithets; the first mention wins for this scene.
      if (linkedCharacterIds.has(entry.id)) continue;
      linkedCharacterIds.add(entry.id);

      const descriptionDelta = reported.descriptionDelta?.trim() || null;
      const stateChanges = reported.stateChanges?.trim() || null;
      // Conflict means this scene is being re-analyzed: refresh the link with
      // the new analysis. `xmax = 0` distinguishes a fresh insert (count the
      // scene) from a conflict-update (already counted by the first pass).
      const link = await tx
        .insert(sceneCharacters)
        .values({
          sceneId,
          characterId: entry.id,
          mentionName,
          descriptionDelta,
          stateChanges: stateChanges ? { note: stateChanges } : null,
        })
        .onConflictDoUpdate({
          target: [sceneCharacters.sceneId, sceneCharacters.characterId],
          set: {
            mentionName,
            descriptionDelta,
            stateChanges: stateChanges ? { note: stateChanges } : null,
            updatedAt: new Date(),
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      if (link[0]?.inserted) {
        await tx
          .update(characters)
          .set({ sceneCount: sql`${characters.sceneCount} + 1` })
          .where(eq(characters.id, entry.id));
      }
      if (entry.oneLineDesc === null && !descUpdates.has(entry) && descriptionDelta) {
        descUpdates.set(entry, descriptionDelta);
      }
    }

    // Re-analysis convergence: drop links from a previous analysis of this
    // scene whose characters the new analysis no longer reports, decrementing
    // their sceneCount so the counts keep matching the links.
    const staleLinks = await tx
      .delete(sceneCharacters)
      .where(
        linkedCharacterIds.size > 0
          ? and(
              eq(sceneCharacters.sceneId, sceneId),
              notInArray(sceneCharacters.characterId, [...linkedCharacterIds]),
            )
          : eq(sceneCharacters.sceneId, sceneId),
      )
      .returning({ characterId: sceneCharacters.characterId });
    for (const stale of staleLinks) {
      await tx
        .update(characters)
        .set({ sceneCount: sql`greatest(${characters.sceneCount} - 1, 0)` })
        .where(eq(characters.id, stale.characterId));
    }

    await tx
      .update(scenes)
      .set({
        summary: analysis.summary,
        setting: analysis.setting,
        timeOfDay: analysis.timeOfDay,
        mood: analysis.mood,
        sceneType: analysis.sceneType,
        keyVisualMoment: analysis.keyVisualMoment,
        analysisStatus: 'done',
      })
      .where(eq(scenes.id, sceneId));
  });

  // Commit succeeded: publish staged mutations to the shared roster.
  roster.push(...newEntries);
  for (const [entry, desc] of descUpdates) {
    if (entry.oneLineDesc === null) entry.oneLineDesc = desc;
  }
}

/**
 * Analyze stage: per-scene LLM analysis (sequential), character extraction
 * with an incrementally-built roster, then hand-off to the profiles stage.
 *
 * Resume-safe: scenes already 'done' are skipped, the roster is rebuilt from
 * existing character rows, and per-scene writes tolerate a crash mid-scene.
 * A single scene failing is recorded ('failed') and skipped — only systemic
 * errors (server unreachable / model missing / early mass failure) abort.
 */
export async function runAnalyze({ bookId, runId }: StageJobPayload): Promise<void> {
  const db = getDb();

  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) throw new Error(`analyze: book ${bookId} not found`);

  // runId fence: a newer run supersedes this job (it may have been waiting in
  // the queue or retrying). Bail before ANY write — touching book status or
  // reportProgress here would clobber the newer run's state, and this stage
  // deletes/links character rows the newer run now owns.
  if (await isRunSuperseded(bookId, runId)) {
    console.log(`[analyze ${bookId}] run ${runId} superseded by a newer run; skipping`);
    return;
  }

  await setBookStatus(bookId, 'analyzing');
  await reportProgress(runId, { stage: 'analyze', percent: 0, currentStep: 'Preparing analysis' });

  const llm: LLM = await resolveLlm(db, book);
  const health = await llm.healthCheck();
  if (!health.ok) {
    throw new Error(
      `analyze: Ollama health check failed for model '${llm.model}': ${health.detail}`,
    );
  }

  const chapterRows = await db
    .select({ id: chapters.id, idx: chapters.idx, title: chapters.title, text: chapters.text })
    .from(chapters)
    .where(eq(chapters.bookId, bookId));
  const chapterById = new Map(chapterRows.map((c) => [c.id, c]));

  const sceneRows = await db
    .select({
      id: scenes.id,
      chapterId: scenes.chapterId,
      globalIdx: scenes.globalIdx,
      startOffset: scenes.startOffset,
      endOffset: scenes.endOffset,
      analysisStatus: scenes.analysisStatus,
      summary: scenes.summary,
    })
    .from(scenes)
    .where(eq(scenes.bookId, bookId))
    .orderBy(asc(scenes.globalIdx));
  if (sceneRows.length === 0) {
    throw new Error(`analyze: book ${bookId} has no scenes (did segment run?)`);
  }

  const roster = await loadRoster(db, bookId);

  const total = sceneRows.length;
  let finished = sceneRows.filter((s) => s.analysisStatus === 'done').length;
  let prevSummary: string | null = null;
  let attempted = 0;
  let failed = 0;

  for (const scene of sceneRows) {
    const chapter = chapterById.get(scene.chapterId);
    if (!chapter) throw new Error(`analyze: scene ${scene.id} references missing chapter`);

    if (scene.analysisStatus === 'done') {
      // Resume: keep continuity context from the already-analyzed scene.
      prevSummary = scene.summary ?? prevSummary;
      continue;
    }

    await reportProgress(runId, {
      stage: 'analyze',
      percent: ((finished + failed) / total) * 100,
      currentStep: `Analyzing scene ${scene.globalIdx + 1}/${total} — Ch ${chapter.idx + 1}`,
    });

    const sceneText = chapter.text.slice(scene.startOffset, scene.endOffset);
    const { system, prompt } = buildSceneAnalysisPrompt({
      sceneText,
      roster,
      prevSummary,
      bookTitle: book.title,
      mature: book.matureContent,
    });

    attempted++;
    try {
      const result = await completeStructured(llm, {
        system,
        prompt,
        schema: sceneAnalysisSchema,
        maxAttempts: 3,
        temperature: 0.2,
      });
      await incrementRunTokens(runId, result.tokensIn, result.tokensOut);
      await persistSceneAnalysis(db, { bookId, sceneId: scene.id, analysis: result.value, roster });
      prevSummary = result.value.summary;
      finished++;
    } catch (err) {
      if (!(err instanceof StructuredOutputError) && !(err instanceof OllamaError)) throw err;

      // Systemic: the server is gone or the model is missing — every
      // subsequent scene would fail too, so abort and let BullMQ retry.
      if (err instanceof OllamaError && err.code && SYSTEMIC_OLLAMA_CODES.has(err.code)) {
        throw new Error(`analyze: systemic Ollama failure (${err.code}): ${err.message}`);
      }

      failed++;
      console.error(
        `[analyze ${bookId}] scene ${scene.globalIdx + 1}/${total} failed: ${err.message}`,
      );
      await db
        .update(scenes)
        .set({ analysisStatus: 'failed' })
        .where(eq(scenes.id, scene.id));

      if (attempted <= EARLY_FAILURE_WINDOW && failed > EARLY_FAILURE_WINDOW / 2) {
        throw new Error(
          `analyze: ${failed} of the first ${attempted} scenes failed — aborting as systemic ` +
            `(last error: ${redactSecrets(err.message)})`,
        );
      }
      // Otherwise: a stray hard scene must never block the whole book.
    }
  }

  console.log(
    `[analyze ${bookId}] complete: ${finished}/${total} scenes analyzed` +
      (failed > 0 ? `, ${failed} failed` : '') +
      `, roster size ${roster.length}`,
  );

  await reportProgress(runId, {
    stage: 'analyze',
    percent: 100,
    currentStep: 'Analysis complete — queued for character profiling',
  });
  await setBookStatus(bookId, 'profiling');
  // Auto-chain: analyze is only ever reached via the full pipeline (upload
  // wizard) or the manual "analyze" re-run, both of which are meant to flow
  // through to finished art. `autoChain` tells profiles to continue into
  // imagine; only the standalone "Rebuild profiles" button skips it.
  await getQueue('profiles').add('profiles', { bookId, runId, autoChain: true });
}
