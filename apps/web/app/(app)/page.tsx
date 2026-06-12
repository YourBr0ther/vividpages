import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Bookcase } from '@/components/bookcase';
import { toBookCardData } from '@/lib/book-card-data';
import { listBooksWithLatestRun } from '@/lib/queries';

export const metadata = { title: 'Library · VividPages' };

/**
 * The Bookcase — the authenticated home. Fetches the shelf directly from the
 * database (no server-side fetch round-trip) and hands a serializable list
 * to the client component, which layers uploads/progress/deletes on top.
 */
export default async function BookcasePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');

  const books = (await listBooksWithLatestRun(userId)).map(toBookCardData);

  return <Bookcase initialBooks={books} />;
}
