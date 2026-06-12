import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { verify } from '@node-rs/argon2';
import { accounts, getDb, sessions, users, verificationTokens } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import type { Adapter } from 'next-auth/adapters';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import authConfig from './auth.config';
import { ARGON2_OPTIONS } from './lib/password';
import { createFixedWindowLimiter } from './lib/rate-limit';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// Precomputed argon2id hash (same ARGON2_OPTIONS params) of a throwaway
// string. When the user doesn't exist or has no password we still verify
// against this so unknown-email and wrong-password take similar time,
// preventing account enumeration via response timing.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$TtH9mupl9Okz6aDrv6qLsQ$B6mlKkkFR7WhRCQxYUNubFD98REVDwfJS1Gf0/19OFA';

// Brute-force guard: 10 failed logins per 15 minutes per (normalized) email.
// authorize() has no easy access to the request IP, so key by email; only
// failures count, and a successful login clears the bucket.
const loginLimiter = createFixedWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

/**
 * Lazily construct the Drizzle adapter on first use. getDb() requires
 * DATABASE_URL, which isn't (and shouldn't be) available during `next build`;
 * constructing the adapter at module scope would make the build fail.
 */
function lazyDrizzleAdapter(): Adapter {
  let real: Adapter | undefined;
  return new Proxy({} as Adapter, {
    get(_target, prop) {
      real ??= DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      });
      return Reflect.get(real, prop);
    },
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // With session.strategy 'jwt' the adapter is not used for sessions; it is
  // what lets the Google provider create/link users + accounts rows.
  adapter: lazyDrizzleAdapter(),
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();
        const limiterKey = `login:${email}`;
        if (loginLimiter.isLimited(limiterKey)) return null;

        const user = await getDb().query.users.findFirst({
          where: eq(users.email, email),
        });
        // OAuth-only users have no passwordHash and cannot use this provider.
        // Burn an argon2 verify against a dummy hash anyway (see above).
        if (!user?.passwordHash) {
          await verify(DUMMY_PASSWORD_HASH, parsed.data.password, ARGON2_OPTIONS);
          loginLimiter.hit(limiterKey);
          return null;
        }

        const valid = await verify(
          user.passwordHash,
          parsed.data.password,
          ARGON2_OPTIONS,
        );
        if (!valid) {
          loginLimiter.hit(limiterKey);
          return null;
        }
        loginLimiter.reset(limiterKey);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
