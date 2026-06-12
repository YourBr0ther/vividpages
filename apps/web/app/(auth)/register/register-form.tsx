'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { inputClass } from '../form-styles';

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    // Stay pending on the successful navigation paths; only re-enable the
    // button when registration failed or threw (e.g. network failure).
    let navigating = false;
    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get('email') ?? '');
      const password = String(form.get('password') ?? '');
      const name = String(form.get('name') ?? '').trim();

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? 'Registration failed. Please try again.');
        return;
      }

      // Account created — sign in with the same credentials.
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      navigating = true;
      if (result?.error) {
        // Unlikely, but fall back to the login page rather than crashing.
        router.push('/login');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      if (!navigating) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block text-stone-300">Name (optional)</span>
        <input
          name="name"
          type="text"
          autoComplete="name"
          className={inputClass}
          placeholder="Jane Reader"
        />
      </label>
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
          autoComplete="new-password"
          required
          minLength={8}
          className={inputClass}
          placeholder="At least 8 characters"
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
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
