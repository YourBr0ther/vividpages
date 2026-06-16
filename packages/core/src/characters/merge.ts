/**
 * Reusable, post-pipeline-safe character merge.
 *
 * Unlike the profiles-stage internal merge (pipeline/profiles.ts), which runs
 * before any art exists, this one fully reconciles two character rows AFTER the
 * pipeline has produced illustration_points and images. It is the engine behind
 * the manual "merge duplicates" action: the user picks a surviving primary
 * (`keepId`, keeps profile / portrait / appearanceToken / role / LoRA /
 * embedding) and a row to absorb (`absorbId`, contributes its scene appearances
 * and its name as an alias, then is deleted).
 *
 * The two pure helpers (`mergedAliases`, `remapPresentIds`) are exported and
 * unit-tested; the transactional DB work lives in `mergeCharacters`.
 */
import { characters, illustrationPoints, images, sceneCharacters, type Db } from '@vividpages/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { nameKey, normalizeCharacterName } from '../analysis/roster';
import { redactSecrets } from '../redact';
import { deleteObject } from '../storage';

/**
 * A character merge failed a precondition. `SAME_ID`: the two ids are equal.
 * `NOT_FOUND`: a row is missing OR belongs to a different book (the query is
 * scoped to `bookId`, so a wrong-book id reads as absent — the API layer
 * re-checks ownership before calling this).
 */
export class CharacterMergeError extends Error {
  constructor(
    message: string,
    readonly code: 'SAME_ID' | 'NOT_FOUND',
  ) {
    super(message);
    this.name = 'CharacterMergeError';
  }
}

/**
 * Union of the kept and absorbed alias lists (plus the absorbed character's
 * name), display-normalized and deduped by match key, excluding the kept
 * character's own name. Order: kept aliases, then the absorbed name, then the
 * absorbed aliases. Pure (no IO), unit-tested.
 */
export function mergedAliases(
  keep: { name: string; aliases: string[] },
  absorb: { name: string; aliases: string[] },
): string[] {
  const seen = new Set([nameKey(keep.name)]);
  const out: string[] = [];
  for (const raw of [...keep.aliases, absorb.name, ...absorb.aliases]) {
    const display = normalizeCharacterName(raw);
    const key = nameKey(display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(display);
  }
  return out;
}

/**
 * Remaps a point's `presentCharacterIds`: every occurrence of `absorbId` becomes
 * `keepId`, the result is deduped (preserving first-seen order). No-op when
 * `absorbId` is absent. When both ids are already present they collapse to a
 * single `keepId`. Pure (no IO), unit-tested.
 */
export function remapPresentIds(ids: string[], absorbId: string, keepId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const mapped = id === absorbId ? keepId : id;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

interface CharacterRow {
  id: string;
  bookId: string;
  name: string;
  aliases: string[];
}

/**
 * Fully merges the `absorbId` character into `keepId` within one transaction:
 *
 *  - Validates both rows exist, belong to `bookId`, and the ids are distinct
 *    (throws a typed CharacterMergeError otherwise).
 *  - Moves `scene_characters` links absorb → keep; when the keeper already links
 *    a scene the absorbed link is dropped instead (PK is (sceneId, characterId)).
 *  - Aliases become keep.aliases ∪ absorb.name ∪ absorb.aliases.
 *  - illustration_points: every point whose `presentCharacterIds` contains
 *    absorbId is remapped (absorbId → keepId, deduped); their ids are collected
 *    as `affectedPointIds` (the scenes that must re-illustrate).
 *  - sceneCount is recounted from the surviving links.
 *  - The absorbed row's `character_portrait` image rows are deleted (DB rows in
 *    the tx; their MinIO objects best-effort outside the tx). The keeper's own
 *    portrait is untouched.
 *  - The absorbed character row is deleted.
 *
 * Returns the affected illustration-point ids so the caller can enqueue a
 * targeted regen.
 */
export async function mergeCharacters(
  db: Db,
  args: { keepId: string; absorbId: string; bookId: string },
): Promise<{ affectedPointIds: string[] }> {
  const { keepId, absorbId, bookId } = args;
  if (keepId === absorbId) {
    throw new CharacterMergeError('cannot merge a character into itself', 'SAME_ID');
  }

  // Object keys to clean up from MinIO AFTER the transaction commits (a failed
  // object delete must never roll back the data merge).
  const objectKeysToDelete: string[] = [];
  let affectedPointIds: string[] = [];

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: characters.id,
        bookId: characters.bookId,
        name: characters.name,
        aliases: characters.aliases,
      })
      .from(characters)
      .where(and(eq(characters.bookId, bookId), inArray(characters.id, [keepId, absorbId])));

    const keep = rows.find((r) => r.id === keepId) as CharacterRow | undefined;
    const absorb = rows.find((r) => r.id === absorbId) as CharacterRow | undefined;
    if (!keep) {
      throw new CharacterMergeError(
        `keep character ${keepId} not found in book ${bookId}`,
        'NOT_FOUND',
      );
    }
    if (!absorb) {
      throw new CharacterMergeError(
        `absorb character ${absorbId} not found in book ${bookId}`,
        'NOT_FOUND',
      );
    }

    // --- scene_characters: move absorb → keep (drop conflicting links) -------
    const keptLinks = await tx
      .select({ sceneId: sceneCharacters.sceneId })
      .from(sceneCharacters)
      .where(eq(sceneCharacters.characterId, keepId));
    const keptSceneIds = keptLinks.map((l) => l.sceneId);
    if (keptSceneIds.length > 0) {
      await tx
        .delete(sceneCharacters)
        .where(
          and(
            eq(sceneCharacters.characterId, absorbId),
            inArray(sceneCharacters.sceneId, keptSceneIds),
          ),
        );
    }
    await tx
      .update(sceneCharacters)
      .set({ characterId: keepId })
      .where(eq(sceneCharacters.characterId, absorbId));

    // --- illustration_points: remap presentCharacterIds (absorb → keep) ------
    // presentCharacterIds is text[]; do the remap+dedupe in JS (postgres array
    // ops are clumsy for "replace one element then dedupe"). Only points that
    // actually reference the absorbed id are touched.
    const pointRows = await tx
      .select({ id: illustrationPoints.id, presentCharacterIds: illustrationPoints.presentCharacterIds })
      .from(illustrationPoints)
      .where(
        and(
          eq(illustrationPoints.bookId, bookId),
          sql`${absorbId} = ANY(${illustrationPoints.presentCharacterIds})`,
        ),
      );
    affectedPointIds = pointRows.map((p) => p.id);
    for (const point of pointRows) {
      await tx
        .update(illustrationPoints)
        .set({ presentCharacterIds: remapPresentIds(point.presentCharacterIds, absorbId, keepId) })
        .where(eq(illustrationPoints.id, point.id));
    }

    // --- absorbed portrait images: delete rows (objects cleaned post-commit) --
    const portraitRows = await tx
      .select({ objectKey: images.objectKey, thumbObjectKey: images.thumbObjectKey })
      .from(images)
      .where(
        and(
          eq(images.bookId, bookId),
          eq(images.kind, 'character_portrait'),
          eq(images.subjectId, absorbId),
        ),
      );
    for (const row of portraitRows) {
      if (row.objectKey) objectKeysToDelete.push(row.objectKey);
      if (row.thumbObjectKey) objectKeysToDelete.push(row.thumbObjectKey);
    }
    await tx
      .delete(images)
      .where(
        and(
          eq(images.bookId, bookId),
          eq(images.kind, 'character_portrait'),
          eq(images.subjectId, absorbId),
        ),
      );

    // --- keeper: merged aliases + recounted sceneCount -----------------------
    await tx
      .update(characters)
      .set({
        aliases: mergedAliases(keep, absorb),
        sceneCount: sql`(select count(*)::int from ${sceneCharacters} where ${sceneCharacters.characterId} = ${keepId})`,
      })
      .where(eq(characters.id, keepId));

    // --- delete the absorbed row --------------------------------------------
    await tx.delete(characters).where(eq(characters.id, absorbId));
  });

  // Best-effort MinIO cleanup of the dropped portrait's objects. The DB rows are
  // already gone (source of truth); orphaned objects are harmless, so swallow.
  for (const key of objectKeysToDelete) {
    try {
      await deleteObject('images', key);
    } catch (err) {
      console.warn(
        `[merge ${bookId}] failed to delete portrait object ${key} (ignored): ${redactSecrets(String(err))}`,
      );
    }
  }

  return { affectedPointIds };
}
