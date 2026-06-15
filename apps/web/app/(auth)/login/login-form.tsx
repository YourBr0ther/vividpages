'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { purgeContentCaches } from '@/lib/purge-caches';

import { inputClass } from '../form-styles';

export function LoginForm({
  callbackUrl,
  googleEnabled,
}: {
  callbackUrl: string;
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    // Stay pending on the successful navigation path; only re-enable the
    // button when sign-in failed or threw (e.g. network failure).
    let navigating = false;
    try {
      const form = new FormData(event.currentTarget);
      const result = await signIn('credentials', {
        email: form.get('email'),
        password: form.get('password'),
        redirect: false,
      });
      if (result?.error) {
        setError('Invalid email or password.');
        return;
      }
      // Defensively purge any private SW caches left by a prior user who may
      // have closed the tab without using the sign-out button.
      await purgeContentCaches();
      navigating = true;
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      if (!navigating) setPending(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-stone-300">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-stone-300">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
            placeholder="••••••••"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-400 disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span className="h-px flex-1 bg-stone-800" />
            or
            <span className="h-px flex-1 bg-stone-800" />
          </div>
          <button
            type="button"
            onClick={() => signIn('google', { redirectTo: callbackUrl })}
            className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm font-medium text-stone-200 transition hover:bg-stone-800"
          >
            Continue with Google
          </button>
        </>
      ) : null}
    </div>
  );
}
