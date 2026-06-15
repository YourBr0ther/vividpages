import { getDb, userSettings } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';

/** Defaults mirror the user_settings column defaults (see packages/db schema). */
const DEFAULTS = {
  llmProvider: 'ollama',
  llmModel: 'llama3.1:8b',
  embeddingProvider: 'ollama',
  embeddingModel: 'nomic-embed-text',
  imageProvider: 'comfyui',
  imageModel: null as string | null,
  ollamaUrl: null as string | null,
  comfyuiUrl: null as string | null,
} as const;

/** A URL override, or null when blank (= use the env default). */
const urlOverride = z
  .string()
  .trim()
  .max(2048)
  .url('Must be a valid URL.')
  .nullable()
  .or(z.literal('').transform(() => null));

const settingsSchema = z.object({
  llmProvider: z.enum(['ollama', 'anthropic', 'openai']),
  llmModel: z.string().trim().min(1).max(120),
  embeddingProvider: z.enum(['ollama', 'openai']),
  embeddingModel: z.string().trim().min(1).max(120),
  imageProvider: z.enum(['comfyui', 'openai']),
  imageModel: z.string().trim().max(120).nullable().or(z.literal('').transform(() => null)),
  ollamaUrl: urlOverride,
  comfyuiUrl: urlOverride,
});

/**
 * GET /api/settings — the session user's settings, falling back to the schema
 * defaults when no row exists yet.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const row = await getDb().query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  const settings = row
    ? {
        llmProvider: row.llmProvider,
        llmModel: row.llmModel,
        embeddingProvider: row.embeddingProvider,
        embeddingModel: row.embeddingModel,
        imageProvider: row.imageProvider,
        imageModel: row.imageModel,
        ollamaUrl: row.ollamaUrl,
        comfyuiUrl: row.comfyuiUrl,
      }
    : DEFAULTS;

  return NextResponse.json({ settings });
}

/**
 * PUT /api/settings — upsert the session user's provider/model defaults and
 * local endpoint overrides.
 */
export async function PUT(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid settings.' },
      { status: 400 },
    );
  }
  const values = parsed.data;

  await getDb()
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...values, updatedAt: new Date() },
    });

  return NextResponse.json({ settings: values });
}
