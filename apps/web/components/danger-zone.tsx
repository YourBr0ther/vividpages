'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from './confirm-dialog';

/**
 * The detail page's destructive corner: delete the book (and everything
 * derived from it) behind the shared confirm dialog, then return to the
 * Bookcase.
 */
export function DangerZone({ bookId, bookTitle }: { bookId: string; bookTitle: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
      // 404 means it's already gone — treat as success.
      if (res.ok || res.status === 404) {
        router.push('/');
        router.refresh();
        return;
      }
      setError('Could not delete the book. Please try again.');
    } catch {
      setError('Could not delete the book. Check your connection and try again.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section
      aria-label="Danger zone"
      className="rounded-xl border border-red-900/40 bg-red-950/15 p-5"
    >
      <h2 className="font-display text-lg tracking-tight text-red-200">Danger zone</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-400">
        Deleting removes the book, its chapters and scenes, and any generated art. There is no
        undo.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-4 rounded-full border border-red-400/40 px-4 py-1.5 text-sm text-red-300 transition hover:bg-red-950/60 focus-visible:ring-2 focus-visible:ring-red-400/60"
      >
        Delete this book
      </button>

      {confirming ? (
        <ConfirmDialog
          title="Remove this book?"
          body={`“${bookTitle}” and everything generated for it will be deleted. This cannot be undone.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={handleDelete}
          onCancel={() => {
            if (!busy) setConfirming(false);
          }}
        />
      ) : null}
    </section>
  );
}
