import { books, getDb, pipelineRuns } from '@vividpages/db';
import { desc, eq, inArray } from 'drizzle-orm';

export type BookRow = typeof books.$inferSelect;
export type PipelineRunRow = typeof pipelineRuns.$inferSelect;

export type BookWithLatestRun = BookRow & { latestRun: PipelineRunRow | null };

/**
 * The user's books, newest first, each with its latest pipeline run (or
 * null). Shared by GET /api/books and the Bookcase server component so both
 * return the same shape without a server-side fetch round-trip.
 */
export async function listBooksWithLatestRun(userId: string): Promise<BookWithLatestRun[]> {
  const db = getDb();
  const rows = await db.query.books.findMany({
    where: eq(books.userId, userId),
    orderBy: desc(books.createdAt),
  });

  const latestRunByBook = new Map<string, PipelineRunRow>();
  if (rows.length > 0) {
    const runs = await db
      .select()
      .from(pipelineRuns)
      .where(
        inArray(
          pipelineRuns.bookId,
          rows.map((b) => b.id),
        ),
      )
      .orderBy(desc(pipelineRuns.startedAt));
    // Rows arrive newest-first, so the first run seen per book is the latest.
    for (const run of runs) {
      if (!latestRunByBook.has(run.bookId)) latestRunByBook.set(run.bookId, run);
    }
  }

  return rows.map((book) => ({ ...book, latestRun: latestRunByBook.get(book.id) ?? null }));
}
