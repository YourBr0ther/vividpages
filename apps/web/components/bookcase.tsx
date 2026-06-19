'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { toBookCardData, type BookCardData, type BookLike } from '@/lib/book-card-data';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits';

import { BookCard, UploadingBookCard } from './book-card';
import { ConfirmDialog } from './confirm-dialog';
import { ToastViewport, useToasts } from './toasts';
import { UploadDrop } from './upload-drop';
import { UploadWizard } from './upload-wizard';

interface PendingUpload {
  key: string;
  title: string;
}

/** A freshly-uploaded book awaiting the wizard's up-front choices. */
interface WizardTarget {
  bookId: string;
  title: string;
  mature: boolean;
}

/**
 * The shelf. Server-rendered list comes in as props; this component layers
 * client-only state on top: optimistic uploads, locally-hidden deletions,
 * books returned by POST that the server list hasn't caught up with yet, and
 * toasts. Reconciliation happens via router.refresh() — once the refreshed
 * server list contains a book, the local copy is dropped.
 */
export function Bookcase({ initialBooks }: { initialBooks: BookCardData[] }) {
  const router = useRouter();
  const { toasts, pushToast, dismissToast } = useToasts();

  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [localBooks, setLocalBooks] = useState<BookCardData[]>([]);
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<BookCardData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wizard, setWizard] = useState<WizardTarget | null>(null);

  const books = useMemo(() => {
    const serverIds = new Set(initialBooks.map((book) => book.id));
    return [...localBooks.filter((book) => !serverIds.has(book.id)), ...initialBooks].filter(
      (book) => !hiddenIds.has(book.id),
    );
  }, [initialBooks, localBooks, hiddenIds]);

  const handleStatusSettled = useCallback(() => {
    // A book just reached ready/failed via SSE: re-pull the server list so the
    // card gets its cover, author, and final metadata.
    router.refresh();
  }, [router]);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      pushToast('error', 'Only .epub files can join the shelf.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      pushToast('error', 'That book is over the 100 MB limit — try a smaller EPUB.');
      return;
    }
    const key = crypto.randomUUID();
    const title = file.name.replace(/\.epub$/i, '');
    setUploads((current) => [{ key, title }, ...current]);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/books', { method: 'POST', body: form });
      if (res.status === 201) {
        const data = (await res.json()) as { book: BookLike & { matureContent?: boolean } };
        setLocalBooks((current) => [toBookCardData(data.book), ...current]);
        // The book is uploaded but not yet started — launch the wizard to
        // collect the up-front choices; its Finish kicks off the pipeline.
        setWizard({
          bookId: data.book.id,
          title: data.book.title,
          mature: data.book.matureContent ?? false,
        });
        router.refresh();
      } else if (res.status === 409) {
        pushToast('info', `“${title}” is already on your shelf.`);
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        pushToast('error', data?.error ?? 'Upload failed. Please try again.');
      }
    } catch {
      pushToast('error', 'Upload failed. Check your connection and try again.');
    } finally {
      setUploads((current) => current.filter((upload) => upload.key !== key));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/books/${deleteTarget.id}`, { method: 'DELETE' });
      // 404 means it's already gone — treat as success.
      if (res.ok || res.status === 404) {
        const removed = deleteTarget;
        setHiddenIds((current) => new Set(current).add(removed.id));
        setLocalBooks((current) => current.filter((book) => book.id !== removed.id));
        setDeleteTarget(null);
        pushToast('info', `“${removed.title}” was removed from your shelf.`);
        router.refresh();
      } else {
        pushToast('error', 'Could not delete the book. Please try again.');
      }
    } catch {
      pushToast('error', 'Could not delete the book. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  const empty = books.length === 0 && uploads.length === 0;
  const count = books.length + uploads.length;

  return (
    <div>
      <header className="animate-rise">
        <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-ember-400/90">
          Library
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-4xl tracking-tight text-parchment sm:text-5xl">
            The Bookcase
          </h1>
          {count > 0 ? (
            <span className="text-sm text-stone-500">
              {count} {count === 1 ? 'book' : 'books'} on the shelf
            </span>
          ) : null}
        </div>
        <div
          aria-hidden
          className="mt-8 h-px w-full bg-gradient-to-r from-ember-400/40 via-stone-700/60 to-transparent"
        />
      </header>

      <section className="mt-10" aria-label="Your books">
        {empty ? (
          <UploadDrop variant="hero" onFile={handleFile} />
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <UploadDrop variant="tile" onFile={handleFile} />
            {uploads.map((upload) => (
              <UploadingBookCard key={upload.key} title={upload.title} />
            ))}
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onDeleteRequest={setDeleteTarget}
                onStatusSettled={handleStatusSettled}
              />
            ))}
          </div>
        )}
      </section>

      {deleteTarget ? (
        <ConfirmDialog
          title="Remove this book?"
          body={`“${deleteTarget.title}” and everything generated for it will be deleted. This cannot be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        />
      ) : null}

      {wizard ? (
        <UploadWizard
          bookId={wizard.bookId}
          bookTitle={wizard.title}
          initialMature={wizard.mature}
          onFinished={() => {
            setWizard(null);
            pushToast('info', `“${wizard.title}” is on its way — generating illustrations.`);
            router.refresh();
          }}
          onCancel={() => {
            // Dismissing leaves the book uploaded-but-not-started; it stays on
            // the shelf and can be started from its detail page.
            setWizard(null);
            pushToast(
              'info',
              `“${wizard.title}” was added but not started yet — open it to begin.`,
            );
            router.refresh();
          }}
        />
      ) : null}

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
