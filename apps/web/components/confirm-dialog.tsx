'use client';

import { useEffect, useId } from 'react';

/**
 * Minimal accessible confirm dialog. Rendered only while open (mount it
 * conditionally); Escape and a backdrop click cancel; the cancel button takes
 * initial focus so Enter doesn't accidentally confirm a destructive action.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 animate-fade-in bg-stone-950/70 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm animate-toast-in rounded-xl border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-black/60"
      >
        <h2 id={titleId} className="font-display text-xl tracking-tight text-parchment">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-400">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-300 transition hover:bg-stone-800 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full bg-red-400/90 px-4 py-1.5 text-sm font-semibold text-stone-950 transition hover:bg-red-300 disabled:opacity-60"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
