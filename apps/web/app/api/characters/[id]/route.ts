import { books, characters, getDb } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { UUID_RE } from '@/lib/find-owned-book';

type RouteContext = { params: Promise<{ id: string }> };

/** Z-Image guidance keeps LoRA strength within this range. */
const MAX_LORA_STRENGTH = 1.5;

/**
 * Per-character LoRA config (issue #2). Every field is optional in the payload
 * so the UI can patch one column at a time, and each may be cleared to null
 * ("None" / empty field). `loraStrength` is clamped into 0–1.5 when provided.
 */
const patchSchema = z
  .object({
    loraName: z.string().trim().min(1).nullable(),
    loraKeyword: z.string().trim().min(1).nullable(),
    loraStrength: z
      .number()
      .nullable()
      .transform((v) =>
        v === null ? null : Math.min(MAX_LORA_STRENGTH, Math.max(0, v)),
      ),
  })
  .partial();

/**
 * Loads a character only if its book belongs to the user (join characters→books,
 * filtered by `books.userId`). Non-UUID ids short-circuit to "not found" rather
 * than throwing a Postgres cast error. Returns undefined for missing characters
 * AND characters owned by someone else (no existence leak).
 */
async function findOwnedCharacter(id: string, userId: string) {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await getDb()
    .select({ id: characters.id })
    .from(characters)
    .innerJoin(books, eq(characters.bookId, books.id))
    .where(and(eq(characters.id, id), eq(books.userId, userId)))
    .limit(1);
  return row;
}

/**
 * PATCH /api/characters/[id] — update only the per-character LoRA columns
 * (`loraName`, `loraKeyword`, `loraStrength`). Auth (401) + ownership via the
 * character's book (404 for missing or other users' characters, no existence
 * leak). Only the provided columns (plus `updatedAt`) are written, so other
 * character fields are never clobbered. Applies on the character's next
 * portrait/scene regeneration.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const { id } = await params;
  const owned = await findOwnedCharacter(id, userId);
  if (!owned) {
    return NextResponse.json({ error: 'Character not found.' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid LoRA settings.' },
      { status: 400 },
    );
  }

  // Only set the columns actually present in the payload, so a partial patch
  // never clobbers untouched LoRA fields (or any other character column).
  const patch: Partial<typeof characters.$inferInsert> = { updatedAt: new Date() };
  if ('loraName' in parsed.data) patch.loraName = parsed.data.loraName;
  if ('loraKeyword' in parsed.data) patch.loraKeyword = parsed.data.loraKeyword;
  if ('loraStrength' in parsed.data) patch.loraStrength = parsed.data.loraStrength;

  const [updated] = await getDb()
    .update(characters)
    .set(patch)
    .where(eq(characters.id, owned.id))
    .returning({
      id: characters.id,
      name: characters.name,
      loraName: characters.loraName,
      loraKeyword: characters.loraKeyword,
      loraStrength: characters.loraStrength,
    });

  return NextResponse.json({ character: updated });
}
