import { apiKeys, getDb, type ApiKeyProvider } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';

const VALID_PROVIDERS = new Set<ApiKeyProvider>(['anthropic', 'openai']);

/**
 * DELETE /api/keys/:provider — remove this user's stored key for the provider.
 * Idempotent: returns 204 whether or not a row existed.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const { provider } = await params;
  if (!VALID_PROVIDERS.has(provider as ApiKeyProvider)) {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 400 });
  }

  await getDb()
    .delete(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider as ApiKeyProvider)));

  return new NextResponse(null, { status: 204 });
}
