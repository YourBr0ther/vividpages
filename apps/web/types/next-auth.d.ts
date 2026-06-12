import type { UserRole } from '@vividpages/db';
import type { DefaultSession } from 'next-auth';
// Importing the module is required for the `declare module 'next-auth/jwt'`
// augmentation below to attach to it.
import type {} from 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    role?: UserRole;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
