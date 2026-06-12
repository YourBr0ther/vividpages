import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { auth } from '@/auth';
import { Reader } from '@/components/reader/reader';
import { findOwnedBook } from '@/lib/find-owned-book';
import {
  getChapterWithScenes,
  getReadingProgress,
  listChaptersWithScenes,
} from '@/lib/queries';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapter?: string | string[] }>;
};

// Deduped across generateMetadata + the page render.
const loadOwnedBook = cache(async (id: string) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');
  return { userId, book: await findOwnedBook(id, userId) };
});

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const { book } = await loadOwnedBook(id);
  return { title: book ? `Reading ${book.title} · VividPages` : 'VividPages' };
}

/**
 * The Reader's server shell: validates ownership, resolves the starting
 * chapter (?chapter= wins, then saved progress, then the beginning), and
 * fetches that chapter's text server-side so the first paint needs no
 * client fetch.
 */
export default async function ReadPage({ params, searchParams }: PageProps) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const { userId, book } = await loadOwnedBook(id);
  if (!book) notFound();

  const chapterList = await listChaptersWithScenes(book.id);
  // Nothing to read yet (still ingesting, or ingest failed) — back to detail.
  if (chapterList.length === 0) redirect(`/books/${book.id}`);

  const chapterParam = Array.isArray(search.chapter) ? search.chapter[0] : search.chapter;
  const requestedIdx = chapterParam !== undefined ? Number(chapterParam) : undefined;
  const hasChapter = (idx: number) => chapterList.some((chapter) => chapter.idx === idx);

  let initialChapterIdx = chapterList[0]!.idx;
  let initialSceneGlobalIdx: number | null = null;

  if (
    requestedIdx !== undefined &&
    Number.isInteger(requestedIdx) &&
    hasChapter(requestedIdx)
  ) {
    initialChapterIdx = requestedIdx;
  } else if (requestedIdx === undefined) {
    // No explicit chapter: resume from saved progress when it still exists.
    const progress = await getReadingProgress(userId, book.id);
    if (progress && hasChapter(progress.chapterIdx)) {
      initialChapterIdx = progress.chapterIdx;
      initialSceneGlobalIdx = progress.sceneGlobalIdx;
    }
  }

  const initialChapter = await getChapterWithScenes(book.id, initialChapterIdx);
  if (!initialChapter) notFound();

  return (
    <Reader
      bookId={book.id}
      bookTitle={book.title}
      chapters={chapterList.map(({ idx, title }) => ({ idx, title }))}
      initialChapter={initialChapter}
      initialSceneGlobalIdx={initialSceneGlobalIdx}
    />
  );
}
