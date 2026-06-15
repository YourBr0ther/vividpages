// @ts-check
import { serwist } from '@serwist/next/config';

// Configurator mode (https://serwist.pages.dev/docs/next/config): the service
// worker is built as a SEPARATE step after `next build`, which makes the
// integration bundler-agnostic. We need this because Next 16 defaults to
// Turbopack and @serwist/next's webpack plugin can't run under it; building
// the SW out-of-band lets the app keep its Turbopack build untouched.
//
// Note: configurator mode precaches ALL prerendered routes by default
// (precachePrerendered), and /~offline is a static page — so it is already in
// the precache manifest, revisioned by Next's build output. We deliberately do
// NOT also add it via additionalPrecacheEntries: that would create a second,
// conflicting entry for the same URL (different revision) and make the service
// worker throw `add-to-cache-list-conflicting-entries` at evaluation time.
export default serwist({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
});
