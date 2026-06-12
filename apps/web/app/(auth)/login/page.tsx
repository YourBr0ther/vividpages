import Link from 'next/link';

import { googleEnabled } from '@/auth.config';

import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · VividPages' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // Only allow same-origin relative paths to prevent open redirects. Reject
  // '//' (protocol-relative) and '/\' (browsers normalize the backslash, so
  // '/\evil.com' becomes '//evil.com').
  const safeCallbackUrl =
    callbackUrl?.startsWith('/') &&
    !callbackUrl.startsWith('//') &&
    !callbackUrl.startsWith('/\\')
      ? callbackUrl
      : '/';

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">
        VividPages
      </h1>
      <p className="mt-1 text-sm text-stone-400">
        Sign in to open your bookcase.
      </p>
      <LoginForm callbackUrl={safeCallbackUrl} googleEnabled={googleEnabled} />
      <p className="mt-6 text-center text-sm text-stone-400">
        No account yet?{' '}
        <Link
          href="/register"
          className="font-medium text-amber-400 hover:text-amber-300"
        >
          Create one
        </Link>
      </p>
    </>
  );
}
