import type { Metadata } from 'next';
import Link from 'next/link';

import { ReloadButton } from './reload-button';

export const metadata: Metadata = {
  title: 'Offline · VividPages',
  description: "You're offline — books you've already opened still read.",
};

/**
 * Offline fallback. Precached by the service worker (see next.config.ts) and
 * served by `fallbacks` in app/sw.ts when a navigation can't reach the network
 * or a cached shell. Deliberately self-contained — no auth, no data fetches —
 * so it renders from cache alone. Styled in the candlelit-library palette.
 */
export default function OfflinePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-stone-950 px-6 text-stone-100">
      <div className="atmosphere" aria-hidden />
      <div className="grain" aria-hidden />

      <section className="relative w-full max-w-lg rounded-2xl border border-stone-800/70 bg-stone-900/60 p-10 text-center shadow-[0_40px_80px_-32px_rgba(0,0,0,0.7)] backdrop-blur-sm">
        {/* A guttering candle: the glow has gone out, but the page remains. */}
        <div className="mx-auto mb-7 flex h-16 w-16 items-center justify-center" aria-hidden>
          <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none">
            <rect x="26" y="26" width="12" height="30" rx="3" className="fill-stone-700" />
            <rect x="26" y="26" width="12" height="6" rx="3" className="fill-stone-600" />
            <line
              x1="32"
              y1="26"
              x2="32"
              y2="14"
              className="stroke-stone-600"
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* A thin wisp of smoke where the flame just was. */}
            <path
              d="M32 14 q5 -4 0 -8 q-5 -4 0 -8"
              className="stroke-ember-400/50"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </div>

        <p className="font-display text-xs uppercase tracking-[0.35em] text-ember-400/80">
          The candle has guttered
        </p>
        <h1 className="mt-3 font-display text-3xl text-parchment">You&rsquo;re offline</h1>

        <p className="mt-5 text-balance text-sm leading-relaxed text-stone-300">
          The network slipped away. VividPages can&rsquo;t reach the shelves right now — but the
          story isn&rsquo;t lost.
        </p>
        <p className="mt-3 text-balance text-sm leading-relaxed text-stone-400">
          Any book you&rsquo;ve already opened in the reader keeps its pages and illustrations
          cached on this device, so you can read on by candlelight until the connection returns.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-full border border-ember-400/40 bg-ember-500/10 px-6 py-2.5 text-sm font-medium text-ember-300 transition hover:bg-ember-500/20"
          >
            Back to your library
          </Link>
          <ReloadButton />
        </div>
      </section>
    </main>
  );
}
