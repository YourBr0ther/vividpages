import { hash } from '@node-rs/argon2';
import { getDb, users, userSettings } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { ARGON2_OPTIONS } from '@/lib/password';
import { createFixedWindowLimiter } from '@/lib/rate-limit';

const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(256),
  name: z.string().trim().min(1).max(120).optional(),
});

// 5 registration attempts per 15 minutes per IP (in-memory, per replica).
const registerLimiter = createFixedWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
});

export async function POST(request: NextRequest) {
  // x-forwarded-for is trusted because Traefik fronts the app and sets it.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (registerLimiter.hit(ip)) {
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
      {
        error: 'Invalid input.',
        issues: z.flattenError(parsed.error).fieldErrors,
      },
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

  const passwordHash = await hash(parsed.data.password, ARGON2_OPTIONS);

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
