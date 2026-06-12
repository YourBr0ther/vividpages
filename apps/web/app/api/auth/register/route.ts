import { hash } from '@node-rs/argon2';
import { getDb, users, userSettings } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(256),
  name: z.string().trim().min(1).max(120).optional(),
});

// --- Rate limiting -----------------------------------------------------------
// Simple in-memory token bucket: 5 registration attempts per 15 minutes per IP.
// NOTE: this state is per-replica (and resets on restart) — good enough for a
// self-hosted single-instance deployment; replace with a shared store (Redis)
// if the web app is ever scaled horizontally.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Opportunistic cleanup so the map doesn't grow unboundedly.
  if (buckets.size > 10_000) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

// -----------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Try again later.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input.', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const db = getDb();

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists.' },
      { status: 409 },
    );
  }

  const passwordHash = await hash(parsed.data.password);

  try {
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, name: parsed.data.name, passwordHash })
        .returning({ id: users.id, email: users.email });
      if (!created) throw new Error('Insert returned no row');
      await tx.insert(userSettings).values({ userId: created.id });
      return created;
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    // Unique-violation race (two concurrent registrations for the same email).
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      return NextResponse.json(
        { error: 'An account with this email already exists.' },
        { status: 409 },
      );
    }
    throw error;
  }
}
