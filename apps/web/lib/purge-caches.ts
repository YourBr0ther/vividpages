/**
 * Names of the Cache Storage buckets the service worker (see app/sw.ts) fills
 * with private, per-user content: chapter text/scene spans, generated images,
 * and authenticated page shells. Server routes enforce ownership on live
 * requests, but bytes already in Cache Storage bypass that check — so on a
 * shared browser one user could be served another user's cached reads.
 */
const CONTENT_CACHE_NAMES = ['book-content', 'book-images', 'pages'] as const;

/**
 * Delete the SW's private runtime caches. Called from client contexts around
 * sign-out (and defensively on sign-in) so a new session can never read the
 * previous user's cached content. No-op where Cache Storage is unavailable
 * (e.g. SSR, or dev where the SW is disabled), so it is always safe to call.
 */
export async function purgeContentCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    await Promise.all(CONTENT_CACHE_NAMES.map((name) => caches.delete(name)));
  } catch {
    // Best-effort: a failure to purge must never block sign-in/out.
  }
}
