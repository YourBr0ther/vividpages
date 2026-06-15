'use client';

import { signOut } from 'next-auth/react';
import { useState } from 'react';

import { purgeContentCaches } from '@/lib/purge-caches';

/**
 * Sign-out control. Purges the service worker's private runtime caches (see
 * lib/purge-caches.ts) before delegating to next-auth's client signOut, so a
 * shared browser can't serve the departing user's cached content to whoever
 * signs in next. Redirects to /login, matching the prior server-action flow.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await purgeContentCaches();
    await signOut({ callbackUrl: '/login' });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-sm text-stone-400 transition hover:text-parchment"
    >
      Sign out
    </button>
  );
}
