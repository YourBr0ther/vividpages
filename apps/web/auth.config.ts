import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Google sign-in is optional for self-hosters: the provider (and its button on
 * the login page) only exists when both env vars are configured.
 */
export const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

/**
 * Edge-safe Auth.js config (no database adapter, no argon2) shared between
 * `middleware.ts` and the full Node config in `auth.ts`. This is the
 * documented Auth.js v5 split-config pattern for database adapters.
 */
export default {
  trustHost: true, // self-hosted behind Traefik; host header is trusted there
  session: { strategy: 'jwt' }, // Credentials provider cannot use DB sessions
  pages: { signIn: '/login' },
  providers: googleEnabled ? [Google] : [],
  callbacks: {
    authorized({ auth }) {
      // Used by middleware: unauthenticated requests get redirected to /login.
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      // `user` is only present at sign-in; persist id + role on the token.
      if (user) {
        token.id = user.id;
        token.role = user.role ?? 'user';
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
