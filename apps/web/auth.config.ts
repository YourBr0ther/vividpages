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
  providers: googleEnabled
    ? [
        // Pass the credentials explicitly so the provider reads the same env
        // vars as the `googleEnabled` gate above (the bare `Google` provider
        // would auto-read AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET instead).
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
      ]
    : [],
  callbacks: {
    authorized({ auth }) {
      // Used by middleware: unauthenticated requests get redirected to /login.
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      // `user` is only present at sign-in; persist id + role on the token.
      // Note: role is frozen into the JWT until the user signs in again.
      if (user) {
        token.id = user.id;
        token.role = user.role ?? 'user';
      }
      return token;
    },
    session({ session, token }) {
      // The jwt callback always sets these at sign-in; a missing id means a
      // malformed token, so fail loudly instead of returning a partial session.
      if (!token.id) throw new Error('JWT is missing user id');
      session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
