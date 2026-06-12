import {
  OllamaError,
  StructuredOutputError,
  completeStructured,
  type Embedder,
  type LLM,
} from '@vividpages/ai';
import { books, characters, getDb, sceneCharacters, scenes, type Db } from '@vividpages/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { buildProfilePrompt, type ProfileMention } from '../analysis/profile-prompt';
import { characterProfileSchema, type CharacterProfile } from '../analysis/profile-schema';
import { nameKey, normalizeCharacterName } from '../analysis/roster';
import { compileAppearanceToken, sanitizeTraitValue } from '../characters/appearance';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  buildEmbeddingText,
  resolveCharacter,
  resolveWithEmbedding,
} from '../characters/dedupe';
import type { ProfilesJobPayload } from '../queues';
import { resolveEmbedder, resolveLlm } from './llm';
import {
  completeRun,
  incrementRunTokens,
  isRunSuperseded,
  reportProgress,
  setBookStatus,
} from './progress';

/** OllamaError codes that indicate the whole stage cannot succeed. */
const SYSTEMIC_OLLAMA_CODES = new Set(['NETWORK', 'TIMEOUT', 'MODEL_NOT_FOUND']);

/** Characters beyond this rank (by sceneCount) need >= MIN_SCENES for a profile. */
const ROLE_SIGNIFICANT_TOP_N = 15;
/** Minimum sceneCount for an LLM profile regardless of rank. */
const MIN_SCENES_FOR_PROFILE = 2;
/** Max characters listed in the LLM reconciliation prompt. */
const MAX_RECONCILE_CHARACTERS = 60;

type MergeVia = 'name' | 'embedding' | 'llm';

interface SurvivorCharacter {
  id: string;
  name: string;
  aliases: string[];
  descriptionSample: string | null;
  embedding: number[] | null;
  sceneCount: number;
  role: string | null;
  /** True when the row already had both a profile and an appearanceToken. */
  hasProfile: boolean;
}

interface Mention extends ProfileMention {
  sceneId: string;
}

/** Best short description for a character: profile.oneLine, else first delta. */
function descriptionSampleOf(
  profile: unknown,
  mentions: Mention[] | undefined,
): string | null {
  if (profile && typeof profile === 'object' && 'oneLine' in profile) {
    const oneLine = (profile as { oneLine?: unknown }).oneLine;
    if (typeof oneLine === 'string' && oneLine.trim()) return oneLine;
  }
  return mentions?.find((m) => m.descriptionDelta?.trim())?.descriptionDelta ?? null;
}

/** Union of alias lists (plus the dupe's name), excluding the kept name. */
function mergedAliases(
  kept: { name: string; aliases: string[] },
  dupe: { name: string; aliases: string[] },
): string[] {
  const seen = new Set([nameKey(kept.name)]);
  const out: string[] = [];
  for (const raw of [...kept.aliases, dupe.name, ...dupe.aliases]) {
    const display = normalizeCharacterName(raw);
    const key = nameKey(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out;
}

/**
 * Merges `dupe` into `kept`, in one transaction:
 *   - scene_characters links move to the kept character; when the kept
 *     character is already linked to a scene, the dupe's link is dropped
 *     instead (PK is (sceneId, characterId)).
 *   - aliases become kept.aliases ∪ dupe.name ∪ dupe.aliases.
 *   - sceneCount is recounted from the surviving links.
 *   - the dupe row is deleted.
 * The in-memory survivor and mention map are updated to match.
 */
async function mergeCharacters(
  db: Db,
  args: {
    kept: SurvivorCharacter;
    dupe: { id: string; name: string; aliases: string[] };
    mentionsByChar: Map<string, Mention[]>;
  },
): Promise<void> {
  const { kept, dupe, mentionsByChar } = args;
  const aliases = mergedAliases(kept, dupe);
  let newSceneCount = kept.sceneCount;

  await db.transaction(async (tx) => {
    const keptLinks = await tx
      .select({ sceneId: sceneCharacters.sceneId })
      .from(sceneCharacters)
      .where(eq(sceneCharacters.characterId, kept.id));
    const keptSceneIds = keptLinks.map((l) => l.sceneId);
    if (keptSceneIds.length > 0) {
      await tx
        .delete(sceneCharacters)
        .where(
          and(
            eq(sceneCharacters.characterId, dupe.id),
            inArray(sceneCharacters.sceneId, keptSceneIds),
          ),
        );
    }
    await tx
      .update(sceneCharacters)
      .set({ characterId: kept.id })
      .where(eq(sceneCharacters.characterId, dupe.id));
    const updated = await tx
      .update(characters)
      .set({
        aliases,
        sceneCount: sql`(select count(*)::int from ${sceneCharacters} where ${sceneCharacters.characterId} = ${kept.id})`,
      })
      .where(eq(characters.id, kept.id))
      .returning({ sceneCount: characters.sceneCount });
    await tx.delete(characters).where(eq(characters.id, dupe.id));
    newSceneCount = updated[0]?.sceneCount ?? newSceneCount;
  });

  kept.aliases = aliases;
  kept.sceneCount = newSceneCount;

  // Mirror the link moves in the in-memory mention map.
  const keptMentions = mentionsByChar.get(kept.id) ?? [];
  const keptScenes = new Set(keptMentions.map((m) => m.sceneId));
  for (const m of mentionsByChar.get(dupe.id) ?? []) {
    if (!keptScenes.has(m.sceneId)) keptMentions.push(m);
  }
  keptMentions.sort((a, b) => a.sceneGlobalIdx - b.sceneGlobalIdx);
  mentionsByChar.set(kept.id, keptMentions);
  mentionsByChar.delete(dupe.id);
}

/** Schema for the LLM reconciliation pass ('which entries are the same person?'). */
const reconciliationSchema = z.object({
  merges: z
    .array(
      z.object({
        /** Canonical entry name, copied exactly from the list. */
        keep: z.string().min(1),
        /** Other entries that are the same person. */
        absorb: z.array(z.string().min(1)),
      }),
    )
    .default([]),
});

function buildReconciliationPrompt(
  bookTitle: string,
  survivors: SurvivorCharacter[],
): { system: string; prompt: string } {
  const system =
    'You reconcile character lists for a storyboard generator. ' +
    'You identify entries that refer to the same person under different names, titles, or ' +
    'role descriptions. Respond ONLY with JSON — no prose, no markdown.';

  const lines = survivors.map((s) => {
    const aka = s.aliases.length > 0 ? ` (aka ${s.aliases.join(', ')})` : '';
    const desc = s.descriptionSample ? ` — ${s.descriptionSample}` : '';
    return `- ${s.name}${aka}${desc} [${s.sceneCount} scene${s.sceneCount === 1 ? '' : 's'}]`;
  });

  const prompt = [
    `Book: ${bookTitle}`,
    '',
    'Character list extracted from this book (name, known aliases, description, scene count):',
    ...lines,
    '',
    'Some entries may still refer to the SAME person: a nickname vs a full name ' +
      "(e.g. 'Becky' vs 'Rebecka'), a surname-only entry, a title, or a role epithet " +
      "(e.g. \"Evie's boss\" when another entry IS that boss). Identify every group of " +
      'entries that refer to the same person.',
    '',
    'Rules:',
    '- keep: the canonical entry — prefer the proper personal name with the most scenes.',
    '- absorb: the other entries for that same person.',
    '- Copy names EXACTLY as they appear in the list above (text before any parenthesis).',
    '- Never merge two characters who merely interact, are related, or work together; only merge entries that are provably the SAME person.',
    "- A role epithet like \"X's boss\" may only be absorbed by the character the book explicitly identifies as holding that role — never by a colleague or bystander.",
    '- Distinct numbered/generic entries (e.g. "Intern 1" and "Intern 2") are DIFFERENT people.',
    '- When unsure, do NOT merge.',
    '- If there is nothing to merge, return {"merges": []}.',
  ].join('\n');

  return { system, prompt };
}

/** Scene-share at/above which a character must be protagonist/antagonist. */
const LEAD_SCENE_RATIO = 0.4;
/** Scene-share at/above which 'minor' is raised to 'supporting'. */
const SUPPORTING_SCENE_RATIO = 0.05;

/**
 * Deterministic floor under the LLM's role judgment: small local models are
 * noisy here (one run calls every named character 'protagonist', the next
 * calls an 85-of-101-scene narrator 'supporting'). Scene share is the
 * strongest importance signal we hold, so it can RAISE a role — never lower
 * one — while protagonist-vs-antagonist stays the model's call.
 */
function clampRole(
  role: CharacterProfile['role'],
  sceneCount: number,
  totalScenes: number,
): CharacterProfile['role'] {
  const ratio = totalScenes > 0 ? sceneCount / totalScenes : 0;
  if (ratio >= LEAD_SCENE_RATIO) return role === 'antagonist' ? 'antagonist' : 'protagonist';
  if (ratio >= SUPPORTING_SCENE_RATIO && role === 'minor') return 'supporting';
  return role;
}

/**
 * Trait hygiene lives in sanitizeTraitValue (characters/appearance.ts):
 * nullish/placeholder echoes ('typical/default outfit (not specified)'),
 * hedging commentary ('possibly … (implied)'), and degenerate bare color
 * adjectives are all normalized to null before the profile is stored.
 */
function normalizeProfile(profile: CharacterProfile): CharacterProfile {
  return {
    ...profile,
    hair: sanitizeTraitValue(profile.hair, 'hair'),
    eyes: sanitizeTraitValue(profile.eyes, 'eyes'),
    skin: sanitizeTraitValue(profile.skin, 'skin'),
    build: sanitizeTraitValue(profile.build, 'build'),
    age: sanitizeTraitValue(profile.age, 'age'),
    attire: sanitizeTraitValue(profile.attire, 'attire'),
    distinguishing: sanitizeTraitValue(profile.distinguishing, 'distinguishing'),
    oneLine: profile.oneLine.trim(),
  };
}

function isSystemicLlmError(err: unknown): boolean {
  return err instanceof OllamaError && err.code != null && SYSTEMIC_OLLAMA_CODES.has(err.code);
}

/**
 * Profiles stage: dedup the raw character table (name pass -> embedding pass
 * -> LLM reconciliation pass), then build a canonical visual profile and a
 * stable appearance token per character.
 *
 * Resume-safe: merges are convergent (re-running them is a no-op on already
 * merged rows) and the profile pass skips characters that already have both
 * a profile and an appearanceToken unless `force` is set.
 */
export async function runProfiles(payload: ProfilesJobPayload): Promise<void> {
  const { bookId, runId, force = false } = payload;
  const db = getDb();
  const log = (msg: string) => console.log(`[profiles ${bookId}] ${msg}`);

  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) throw new Error(`profiles: book ${bookId} not found`);

  // runId fence: a newer run supersedes this job. Bail before ANY write —
  // this stage merges/deletes character rows the newer run now owns, and
  // reportProgress on a superseded run would trip the one-running-run-per-
  // book unique index.
  if (await isRunSuperseded(bookId, runId)) {
    log(`run ${runId} superseded by a newer run; skipping`);
    return;
  }

  await setBookStatus(bookId, 'profiling');
  await reportProgress(runId, {
    stage: 'profiles',
    percent: 0,
    currentStep: 'Preparing character profiles',
  });

  const llm: LLM = await resolveLlm(db, book);
  const health = await llm.healthCheck();
  if (!health.ok) {
    throw new Error(
      `profiles: Ollama health check failed for model '${llm.model}': ${health.detail}`,
    );
  }
  const embedder: Embedder = await resolveEmbedder(db, book.userId);

  // -------------------------------------------------------------------------
  // Load characters (most-mentioned first: they anchor the dedup) + mentions.
  // -------------------------------------------------------------------------
  const rows = await db
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
    .orderBy(desc(characters.sceneCount), asc(characters.createdAt));

  const mentionRows = await db
    .select({
      characterId: sceneCharacters.characterId,
      sceneId: sceneCharacters.sceneId,
      sceneGlobalIdx: scenes.globalIdx,
      descriptionDelta: sceneCharacters.descriptionDelta,
      stateChanges: sceneCharacters.stateChanges,
    })
    .from(sceneCharacters)
    .innerJoin(scenes, eq(sceneCharacters.sceneId, scenes.id))
    .where(eq(scenes.bookId, bookId))
    .orderBy(asc(scenes.globalIdx));
  const mentionsByChar = new Map<string, Mention[]>();
  for (const m of mentionRows) {
    const list = mentionsByChar.get(m.characterId) ?? [];
    list.push(m);
    mentionsByChar.set(m.characterId, list);
  }

  const [sceneCountRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(scenes)
    .where(eq(scenes.bookId, bookId));
  const totalScenes = sceneCountRow?.total ?? 0;

  const mergeLog: Array<{ kept: string; absorbed: string; via: MergeVia }> = [];

  // -------------------------------------------------------------------------
  // Pass 1: deterministic dedup (name keys, then embedding similarity).
  // -------------------------------------------------------------------------
  await reportProgress(runId, {
    stage: 'profiles',
    percent: 2,
    currentStep: `Deduplicating ${rows.length} characters`,
  });

  // One batched embedding call for every raw row up front.
  const embeddingTexts = rows.map((r) =>
    buildEmbeddingText({
      name: r.name,
      aliases: r.aliases,
      descriptionSample: descriptionSampleOf(r.profile, mentionsByChar.get(r.id)),
    }),
  );
  const rawEmbeddings = await embedder.embed(embeddingTexts);

  const survivors: SurvivorCharacter[] = [];
  for (const [i, row] of rows.entries()) {
    const candidate = {
      name: row.name,
      aliases: row.aliases,
      descriptionSample: descriptionSampleOf(row.profile, mentionsByChar.get(row.id)),
    };
    const embedding = rawEmbeddings[i]!;

    // A character that already has an appearanceToken survived a previous
    // full dedup + reconciliation. On re-runs its embedding text is built
    // from the generic profile oneLine, which sits dangerously close to
    // other profiled characters' (e.g. two 'young woman in a dress' lines) —
    // so previously-kept characters only ever merge via exact name evidence.
    const fresh = !row.appearanceToken;

    let via: MergeVia = 'name';
    let resolution = resolveCharacter(candidate, survivors);
    if (resolution === 'needs-embedding' && fresh) {
      via = 'embedding';
      resolution = resolveWithEmbedding({ ...candidate, embedding }, survivors, {
        threshold: DEFAULT_SIMILARITY_THRESHOLD,
      });
    }
    if (resolution === 'needs-embedding') resolution = { kind: 'new' };

    if (resolution.kind === 'existing') {
      const kept = survivors.find((s) => s.id === resolution.id)!;
      await mergeCharacters(db, { kept, dupe: row, mentionsByChar });
      mergeLog.push({ kept: kept.name, absorbed: row.name, via });
      log(`merged '${row.name}' -> '${kept.name}' (via ${via})`);
    } else {
      survivors.push({
        id: row.id,
        name: row.name,
        aliases: row.aliases,
        descriptionSample: candidate.descriptionSample,
        embedding,
        sceneCount: row.sceneCount,
        role: row.role,
        hasProfile: Boolean(row.profile && row.appearanceToken),
      });
    }
  }
  log(`dedup pass: ${rows.length} -> ${survivors.length} characters`);

  // -------------------------------------------------------------------------
  // Pass 2: LLM reconciliation — role-epithets and nicknames that name keys
  // and embeddings both miss ("Evie's boss" === "The Villain"). Only runs
  // when the table still contains never-reconciled characters: re-asking on
  // an already-settled cast risks fresh false merges with no new evidence.
  // -------------------------------------------------------------------------
  const anyFresh = rows.some((r) => !r.appearanceToken);
  if (survivors.length > 1 && anyFresh) {
    await reportProgress(runId, {
      stage: 'profiles',
      percent: 25,
      currentStep: 'Reconciling character list',
    });

    const listed = [...survivors]
      .sort((a, b) => b.sceneCount - a.sceneCount)
      .slice(0, MAX_RECONCILE_CHARACTERS);
    const { system, prompt } = buildReconciliationPrompt(book.title, listed);
    try {
      const result = await completeStructured(llm, {
        system,
        prompt,
        schema: reconciliationSchema,
        maxAttempts: 3,
        temperature: 0,
      });
      await incrementRunTokens(runId, result.tokensIn, result.tokensOut);

      // Only names from the provided list count; hallucinations are ignored.
      const byKey = new Map<string, SurvivorCharacter>();
      for (const s of listed) {
        for (const n of [s.name, ...s.aliases]) byKey.set(nameKey(n), s);
      }
      const alive = new Set(survivors.map((s) => s.id));

      // Not extracted as a pure function: each merge feeds back into the next
      // decision (mergeCharacters recounts the survivor's sceneCount from the
      // DB, and the inversion guard compares live counts), so a pure
      // pre-computation of (kept, absorbed) pairs could diverge from what the
      // sequential merges actually produce.
      for (const merge of result.value.merges) {
        const initialTarget = byKey.get(nameKey(merge.keep));
        if (!initialTarget || !alive.has(initialTarget.id)) continue;
        let target: SurvivorCharacter = initialTarget;
        for (const absorbName of merge.absorb) {
          const dupe = byKey.get(nameKey(absorbName));
          if (!dupe || dupe.id === target.id || !alive.has(dupe.id)) continue;
          // Guard against an inverted pair from the model: always keep the
          // character with more scene evidence.
          const [kept, absorbed] = target.sceneCount >= dupe.sceneCount
            ? [target, dupe]
            : [dupe, target];
          await mergeCharacters(db, { kept, dupe: absorbed, mentionsByChar });
          alive.delete(absorbed.id);
          // Re-point the absorbed entry's names at the survivor.
          for (const n of [absorbed.name, ...absorbed.aliases]) byKey.set(nameKey(n), kept);
          mergeLog.push({ kept: kept.name, absorbed: absorbed.name, via: 'llm' });
          log(`merged '${absorbed.name}' -> '${kept.name}' (via llm)`);
          // An inverted merge deletes the row `target` pointed at; later
          // absorbs in this group must merge into the survivor, never reuse
          // the dead row.
          target = kept;
        }
      }
      for (let i = survivors.length - 1; i >= 0; i--) {
        if (!alive.has(survivors[i]!.id)) survivors.splice(i, 1);
      }
    } catch (err) {
      if (isSystemicLlmError(err)) throw err;
      if (!(err instanceof StructuredOutputError) && !(err instanceof OllamaError)) throw err;
      // Reconciliation is best-effort: a stubborn model must not block profiles.
      log(`LLM reconciliation skipped: ${(err as Error).message}`);
    }
    log(`reconciliation pass: ${survivors.length} characters remain`);
  }

  // -------------------------------------------------------------------------
  // Pass 3: profiles + appearance tokens.
  // -------------------------------------------------------------------------
  const ranked = [...survivors].sort((a, b) => b.sceneCount - a.sceneCount);
  let profiled = 0;
  let failures = 0;
  for (const [rank, s] of ranked.entries()) {
    await reportProgress(runId, {
      stage: 'profiles',
      percent: 30 + (rank / Math.max(1, ranked.length)) * 65,
      currentStep: `Profiling ${s.name} (${rank + 1}/${ranked.length})`,
    });

    const significant = s.sceneCount >= MIN_SCENES_FOR_PROFILE || rank < ROLE_SIGNIFICANT_TOP_N;
    if (significant) {
      if (s.hasProfile && !force) continue; // resume: already profiled
      const { system, prompt } = buildProfilePrompt({
        name: s.name,
        aliases: s.aliases,
        sceneCount: s.sceneCount,
        totalScenes,
        mentions: mentionsByChar.get(s.id) ?? [],
      });
      try {
        const result = await completeStructured(llm, {
          system,
          prompt,
          schema: characterProfileSchema,
          maxAttempts: 3,
          temperature: 0.2,
        });
        await incrementRunTokens(runId, result.tokensIn, result.tokensOut);
        const profile = normalizeProfile(result.value);
        profile.role = clampRole(profile.role, s.sceneCount, totalScenes);
        const appearanceToken = compileAppearanceToken(s.name, profile);
        await db
          .update(characters)
          .set({ profile, role: profile.role, appearanceToken })
          .where(eq(characters.id, s.id));
        s.descriptionSample = profile.oneLine;
        profiled++;
      } catch (err) {
        if (isSystemicLlmError(err)) {
          throw new Error(
            `profiles: systemic Ollama failure (${(err as OllamaError).code}): ${(err as Error).message}`,
          );
        }
        if (!(err instanceof StructuredOutputError) && !(err instanceof OllamaError)) throw err;
        failures++;
        log(`profile for '${s.name}' failed: ${(err as Error).message}`);
      }
    } else if (!s.hasProfile) {
      // Sub-threshold characters get no LLM call: role 'minor' and a token
      // compiled from the name plus the single best description delta.
      // Characters that already carry a full profile (they can drop below
      // the significance threshold when merges shrink the cast) keep their
      // richer role/profile/token — a delta-only token is always a downgrade.
      const delta =
        (mentionsByChar.get(s.id) ?? [])
          .map((m) => m.descriptionDelta?.trim())
          .find((d) => d) ?? null;
      const appearanceToken = compileAppearanceToken(s.name, delta ? { distinguishing: delta } : null);
      await db
        .update(characters)
        .set({ role: 'minor', appearanceToken })
        .where(eq(characters.id, s.id));
    }
  }

  // -------------------------------------------------------------------------
  // Refresh stored embeddings from the final merged identities (one batch),
  // for future cross-book/regeneration checks.
  // -------------------------------------------------------------------------
  await reportProgress(runId, {
    stage: 'profiles',
    percent: 96,
    currentStep: 'Storing character embeddings',
  });
  const finalTexts = survivors.map((s) =>
    buildEmbeddingText({
      name: s.name,
      aliases: s.aliases,
      descriptionSample: s.descriptionSample,
    }),
  );
  const finalEmbeddings = await embedder.embed(finalTexts);
  for (const [i, s] of survivors.entries()) {
    await db
      .update(characters)
      .set({ embedding: finalEmbeddings[i]!, embeddingModel: embedder.model })
      .where(eq(characters.id, s.id));
  }

  const viaCounts = mergeLog.reduce<Record<string, number>>((acc, m) => {
    acc[m.via] = (acc[m.via] ?? 0) + 1;
    return acc;
  }, {});
  log(
    `complete: ${rows.length} -> ${survivors.length} characters ` +
      `(merges: ${JSON.stringify(viaCounts)}), ${profiled} profiled` +
      (failures > 0 ? `, ${failures} profile failures` : ''),
  );

  await reportProgress(runId, {
    stage: 'profiles',
    percent: 100,
    currentStep: 'Character profiles complete',
  });
  // M5: enqueue imagine here instead of completing the run.
  await setBookStatus(bookId, 'ready');
  await completeRun(runId);
}
