'use client';

/** Tiny client island so the offline page can offer a manual retry. */
export function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded-full px-6 py-2.5 text-sm font-medium text-stone-300 transition hover:text-parchment"
    >
      Try reconnecting
    </button>
  );
}
