import NextAuth from 'next-auth';

import authConfig from './auth.config';

// Edge-safe NextAuth instance (no adapter / argon2 / pg) purely for the
// `authorized` callback, which redirects unauthenticated requests to /login.
// (Next 16's build analyzer doesn't accept a destructured `middleware`
// export, so re-export the auth wrapper as the default export instead.)
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Protect everything except: auth API routes, the health check, the login
  // and register pages, Next internals, and static files (anything with an
  // extension, e.g. favicon.ico, icons, manifest).
  matcher: ['/((?!api/auth|api/health|login|register|_next|.*\\..*).*)'],
};
