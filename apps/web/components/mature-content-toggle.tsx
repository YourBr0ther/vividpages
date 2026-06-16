'use client';

import { useState } from 'react';

/**
 * Per-book mature-content toggle. Optimistic-but-correct: the switch flips
 * immediately, the PATCH persists it, and a failure reverts the switch and
 * surfaces an error. Re-running the pipeline (the controls above) is what
 * actually applies the flag to existing scenes.
 */
export function MatureContentToggle({
  bookId,
  initialMature,
  providerIsCloud,
}: {
  bookId: string;
  initialMature: boolean;
  /** The book's effective LLM or image provider is a cloud provider. */
  providerIsCloud: boolean;
}) {
  const [mature, setMature] = useState(initialMature);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    const previous = mature;
    setMature(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matureContent: next }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save.');
      }
    } catch (err) {
      setMature(previous);
      setError(err instanceof Error ? err.message : 'Could not save the setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="Mature content"
      className="rounded-xl border border-stone-800/70 bg-stone-900/40 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg tracking-tight text-parchment">Mature content</h2>
        {saving ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.2em] text-stone-500">
            Saving…
          </span>
        ) : null}
      </div>

      <label htmlFor="book-mature-content" className="mt-4 flex cursor-pointer items-center gap-3">
        <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
          <input
            id="book-mature-content"
            type="checkbox"
            role="switch"
            checked={mature}
            disabled={saving}
            aria-describedby="book-mature-content-help"
            onChange={(e) => void handleChange(e.target.checked)}
            className="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ember-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 disabled:cursor-not-allowed"
          />
          <span
            aria-hidden
            className="h-6 w-11 rounded-full border border-stone-700/70 bg-stone-950/70 transition peer-checked:border-ember-400/60 peer-checked:bg-ember-500/80"
          />
          <span
            aria-hidden
            className="absolute left-0.5 h-5 w-5 rounded-full bg-stone-400 shadow transition peer-checked:translate-x-5 peer-checked:bg-stone-950"
          />
        </span>
        <span className="font-display text-sm tracking-tight text-parchment">
          Faithful depiction
        </span>
      </label>

      <p id="book-mature-content-help" className="mt-3 text-sm leading-relaxed text-stone-500">
        Re-run analysis to apply this to the book&rsquo;s existing scenes.
      </p>

      {mature && providerIsCloud ? (
        <p
          role="note"
          className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm leading-relaxed text-amber-200/90"
        >
          Cloud providers may refuse mature content — use a local model (Ollama / ComfyUI) for
          faithful results.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
