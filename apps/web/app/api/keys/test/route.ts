import { createLLM } from '@vividpages/ai';
import { redactSecrets } from '@vividpages/core/redact';
import { type ApiKeyProvider } from '@vividpages/db';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { getDecryptedKey } from '@/lib/api-keys';

/** Cap the live provider call so a hung connection can't pin the request. */
const TEST_TIMEOUT_MS = 12_000;

const testSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  /** Optional: test a not-yet-saved key. When absent, the stored key is used. */
  apiKey: z.string().min(1).max(512).optional(),
});

/**
 * POST /api/keys/test — verify a provider key works by constructing its LLM
 * adapter and running a healthCheck() (a real, cheap call to the provider with
 * the user's own key). Returns {ok, detail}. A bad/invalid key resolves to
 * {ok:false, detail} — it never crashes the route.
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

  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }
  const { provider, apiKey } = parsed.data;

  const key = apiKey ?? (await getDecryptedKey(userId, provider as ApiKeyProvider));
  if (!key) {
    return NextResponse.json(
      { ok: false, detail: 'No key configured for this provider.' },
      { status: 200 },
    );
  }

  // Construct the adapter and health-check it. Any failure (invalid key,
  // network, timeout) becomes a graceful {ok:false}; we never 5xx here.
  try {
    const llm = createLLM({ provider: provider as 'anthropic' | 'openai', apiKey: key });
    const result = await Promise.race([
      llm.healthCheck(),
      new Promise<{ ok: boolean; detail: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, detail: 'Timed out contacting provider.' }), TEST_TIMEOUT_MS),
      ),
    ]);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const detail = err instanceof Error ? redactSecrets(err.message) : 'Unknown error.';
    return NextResponse.json({ ok: false, detail }, { status: 200 });
  }
}
