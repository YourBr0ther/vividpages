import { books, getDb } from '@vividpages/db';
import { and, eq } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the book only if it belongs to the user; non-UUID ids short-circuit
 * to "not found" instead of throwing a Postgres cast error. Callers treat
 * `undefined` as 404 (no existence leak for other users' books).
 */
export async function findOwnedBook(id: string, userId: string) {
  if (!UUID_RE.test(id)) return undefined;
  return getDb().query.books.findFirst({
    where: and(eq(books.id, id), eq(books.userId, userId)),
  });
}
