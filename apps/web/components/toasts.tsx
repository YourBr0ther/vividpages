'use client';

import { useCallback, useRef, useState } from 'react';

export interface Toast {
  id: number;
  tone: 'info' | 'error';
  message: string;
}

const TOAST_MS = 5000;

/** Lightweight toast state — no library, just a capped list with timed dismissal. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (tone: Toast['tone'], message: string) => {
      const id = ++nextId.current;
      setToasts((current) => [...current.slice(-3), { id, tone, message }]);
      setTimeout(() => dismissToast(id), TOAST_MS);
    },
    [dismissToast],
  );

  return { toasts, pushToast, dismissToast };
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex max-w-md animate-toast-in items-center gap-3 rounded-full border bg-stone-900/95 py-2 pl-4 pr-2 text-sm shadow-xl shadow-black/50 backdrop-blur ${
            toast.tone === 'error'
              ? 'border-red-400/40 text-red-200'
              : 'border-ember-400/40 text-parchment'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="rounded-full px-2 py-0.5 text-stone-500 transition hover:text-parchment"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
