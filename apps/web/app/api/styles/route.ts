import { getDb, stylePresets } from '@vividpages/db';
import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';

/**
 * GET /api/styles — the built-in illustration style presets, for the upload
 * wizard's style step. Returns id/slug/name only (the prompt fragments are an
 * implementation detail of generation).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const styles = await getDb()
    .select({ id: stylePresets.id, slug: stylePresets.slug, name: stylePresets.name })
    .from(stylePresets)
    .where(eq(stylePresets.builtIn, true))
    .orderBy(asc(stylePresets.name));

  return NextResponse.json({ styles });
}
