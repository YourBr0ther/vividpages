import Link from 'next/link';

import { RegisterForm } from './register-form';

export const metadata = { title: 'Create account · VividPages' };

export default function RegisterPage() {
  return (
    <>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="mt-1 text-sm text-stone-400">
        Start building your vivid bookcase.
      </p>
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-stone-400">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-amber-400 hover:text-amber-300"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
