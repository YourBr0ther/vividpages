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
  // extension, e.g. favicon.ico, icons, manifest). Exclusions are end-bounded
  // ($ or a trailing /) so future routes like /api/authors, /api/healthcheck
  // or /registration are NOT accidentally excluded.
  // Note: the dotted-path static exclusion means a dynamic route containing a
  // dot in its path would also bypass middleware.
  matcher: [
    '/((?!api/auth(?:/|$)|api/health$|login$|register$|_next(?:/|$)|.*\\..*).*)',
  ],
};
