import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth, signOut } from '@/auth';

/** Nav destinations that exist later in the build; shown disabled for now. */
function DisabledNavLink({ label }: { label: string }) {
  return (
    <span
      aria-disabled="true"
      title="Coming soon"
      className="cursor-not-allowed select-none rounded-full px-3 py-1.5 text-stone-600"
    >
      {label}
    </span>
  );
}

/**
 * Authenticated app shell: candlelit-ink atmosphere, top nav with the
 * wordmark, primary links, and the session user's identity + sign-out.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  // Middleware already guards these routes; this is defense in depth.
  if (!session?.user) redirect('/login');

  const displayName = session.user.name?.trim() || session.user.email || 'Reader';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="relative min-h-screen bg-stone-950 text-stone-100">
      <div className="atmosphere" aria-hidden />
      <div className="grain" aria-hidden />

      <header className="sticky top-0 z-40 border-b border-stone-800/60 bg-stone-950/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6">
          <Link
            href="/"
            className="font-display text-xl tracking-tight text-parchment transition hover:text-ember-300"
          >
            Vivid<span className="italic text-ember-400">Pages</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 text-sm sm:flex">
            <Link
              href="/"
              className="rounded-full bg-stone-800/70 px-3 py-1.5 font-medium text-parchment"
            >
              Library
            </Link>
            <DisabledNavLink label="Jobs" />
            <Link
              href="/settings"
              className="rounded-full px-3 py-1.5 font-medium text-stone-300 transition hover:bg-stone-800/50 hover:text-parchment"
            >
              Settings
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span
              title={displayName}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-ember-400/40 bg-stone-900 font-display text-sm text-ember-300"
            >
              {initial}
              <span className="sr-only">{displayName}</span>
            </span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/login' });
              }}
            >
              <button
                type="submit"
                className="text-sm text-stone-400 transition hover:text-parchment"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Positioned (paints above the fixed grain/atmosphere layers by tree
          order) but deliberately NOT a stacking context: fixed overlays
          rendered by pages (reader, dialogs) must be able to cover the
          sticky header above. */}
      <main className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-12">
        {children}
      </main>
    </div>
  );
}
