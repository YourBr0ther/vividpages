import { encryptSecret, lastFour } from '@vividpages/core/crypto';
import { apiKeys, getDb } from '@vividpages/db';
import { asc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';

/** Body for POST: add or replace a provider's key. */
const upsertSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  apiKey: z.string().min(1, 'API key is required.').max(512),
  label: z.string().max(120).optional(),
});

/** The masked, client-safe shape — never includes ciphertext/plaintext. */
type MaskedKey = {
  provider: string;
  label: string | null;
  lastFour: string | null;
  createdAt: Date;
};

/**
 * GET /api/keys — the session user's stored API keys, masked. Returns only
 * {provider, label, lastFour, createdAt}; ciphertext is never serialized.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const rows = await getDb()
    .select({
      provider: apiKeys.provider,
      label: apiKeys.label,
      lastFour: apiKeys.lastFour,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(asc(apiKeys.provider));

  return NextResponse.json({ keys: rows satisfies MaskedKey[] });
}

/**
 * POST /api/keys — encrypt and upsert a provider's key on (userId, provider).
 * The plaintext key is encrypted at rest (AES-256-GCM) and only its last 4
 * chars are kept for masked display. Returns the masked record.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }
  const { provider, apiKey, label } = parsed.data;

  const ciphertext = encryptSecret(apiKey.trim());
  const masked = lastFour(apiKey.trim());

  const [row] = await getDb()
    .insert(apiKeys)
    .values({ userId, provider, ciphertext, label: label ?? null, lastFour: masked })
    .onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: { ciphertext, label: label ?? null, lastFour: masked },
    })
    .returning({
      provider: apiKeys.provider,
      label: apiKeys.label,
      lastFour: apiKeys.lastFour,
      createdAt: apiKeys.createdAt,
    });

  return NextResponse.json({ key: row satisfies MaskedKey | undefined }, { status: 201 });
}
