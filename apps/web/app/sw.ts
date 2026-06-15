import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';

// `self.__SW_MANIFEST` is replaced at build time by @serwist/next with the
// precache manifest (Next's static assets + the additionalPrecacheEntries we
// declare in next.config.ts, notably the /~offline fallback page).
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Runtime caching, ordered most-specific-first (the first matching route
 * wins). These sit ahead of Serwist's defaultCache.
 *
 * Note on privacy: the book-content and image responses are auth-protected
 * private JSON/bytes. Caching them in the Cache Storage API is per-browser
 * and same-origin only — there is no cross-user leak — but a shared device's
 * cached reads would be visible to whoever has the browser. That's the same
 * trade-off as any offline-capable reader and is acceptable here.
 */
const runtimeCaching: RuntimeCaching[] = [
  // Auth endpoints must NEVER be cached — always hit the network so sessions,
  // CSRF tokens and sign-in/out stay correct.
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/auth/'),
    handler: new NetworkOnly(),
  },
  // Chapter text + scene spans. StaleWhileRevalidate: a chapter you've opened
  // reads instantly (and offline) from cache, while a background fetch keeps
  // it fresh for next time. Matches /api/books/<id>/content and ?chapter=N.
  {
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin &&
      request.method === 'GET' &&
      /^\/api\/books\/[^/]+\/content/.test(url.pathname),
    handler: new StaleWhileRevalidate({
      cacheName: 'book-content',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 300,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // Generated images (full renders and ?thumb thumbnails). The bytes behind
  // an image id are immutable (regeneration writes a new id), so CacheFirst
  // is ideal — once viewed, a plate renders offline with no revalidation.
  {
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin && request.method === 'GET' && url.pathname.startsWith('/api/images/'),
    handler: new CacheFirst({
      cacheName: 'book-images',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // Page navigations: NetworkFirst so you always get the freshest shell when
  // online, but a cached shell (or the precached /~offline fallback) keeps the
  // app usable when the network is gone.
  {
    matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
    handler: new NetworkFirst({
      cacheName: 'pages',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          purgeOnQuotaError: true,
        }),
      ],
    }),
  },
  // Everything else (static assets, fonts, etc.) → Serwist's sensible defaults.
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        // Served when a navigation can't be fulfilled from network or cache.
        url: '/~offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();
