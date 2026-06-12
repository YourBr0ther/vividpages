import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { verify } from '@node-rs/argon2';
import { accounts, getDb, sessions, users, verificationTokens } from '@vividpages/db';
import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import authConfig from './auth.config';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // With session.strategy 'jwt' the adapter is not used for sessions; it is
  // what lets the Google provider create/link users + accounts rows.
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
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
        const user = await getDb().query.users.findFirst({
          where: eq(users.email, email),
        });
        // OAuth-only users have no passwordHash and cannot use this provider.
        if (!user?.passwordHash) return null;

        const valid = await verify(user.passwordHash, parsed.data.password);
        if (!valid) return null;

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
