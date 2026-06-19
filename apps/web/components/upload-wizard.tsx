'use client';

import { useEffect, useId, useRef, useState } from 'react';

/** A built-in style preset, as returned by GET /api/styles. */
interface StyleOption {
  id: string;
  slug: string;
  name: string;
}

/** The slug pre-selected when the styles load (mirrors imagine's default). */
const DEFAULT_STYLE_SLUG = 'painterly-fantasy';

type Step = 'mature' | 'style';
const STEPS: Step[] = ['mature', 'style'];

/**
 * Post-upload wizard: collects every up-front choice in one pass — "Is this a
 * mature book?" and the illustration style — then Finish (POST
 * /api/books/[id]/start) persists them and kicks off the whole auto-chained
 * pipeline to finished art. No further clicks; the user checks progress later.
 *
 * Modeled on ConfirmDialog (modal, Escape to cancel, focus trap) so it matches
 * the app's existing dialog patterns.
 */
export function UploadWizard({
  bookId,
  bookTitle,
  initialMature,
  onFinished,
  onCancel,
}: {
  bookId: string;
  bookTitle: string;
  /** Pre-fills the mature step from the book's seeded value. */
  initialMature: boolean;
  /** Called after Finish succeeds (202). */
  onFinished: () => void;
  /** Called when the user dismisses the wizard without starting. */
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [stepIdx, setStepIdx] = useState(0);
  const [mature, setMature] = useState(initialMature);
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEPS[stepIdx]!;
  const isLast = stepIdx === STEPS.length - 1;

  // Load the style presets; default-select the painterly slug (or the first).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/styles');
        if (!res.ok) return;
        const data = (await res.json()) as { styles: StyleOption[] };
        if (cancelled) return;
        setStyles(data.styles);
        const fallback = data.styles.find((s) => s.slug === DEFAULT_STYLE_SLUG) ?? data.styles[0];
        setStyleId((current) => current ?? fallback?.id ?? null);
      } catch {
        // Styles are optional — Finish with a null preset uses the default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, submitting]);

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matureContent: mature, stylePresetId: styleId }),
      });
      if (res.status === 202) {
        onFinished();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? 'Could not start the book. Please try again.');
    } catch {
      setError('Could not start the book. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 animate-fade-in bg-stone-950/70 backdrop-blur-sm"
        onClick={() => !submitting && onCancel()}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md animate-toast-in rounded-xl border border-stone-800 bg-stone-900 p-6 shadow-2xl shadow-black/60"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-ember-400/90">
          Set up · Step {stepIdx + 1} of {STEPS.length}
        </p>
        <h2 id={titleId} className="mt-2 truncate font-display text-xl tracking-tight text-parchment">
          {bookTitle}
        </h2>

        {step === 'mature' ? (
          <div className="mt-5">
            <h3 className="font-display text-lg tracking-tight text-parchment">
              Is this a mature book?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              When on, the pipeline depicts mature source content faithfully rather than
              euphemizing it. Use a local model for faithful results.
            </p>
            <label htmlFor="wizard-mature" className="mt-4 flex cursor-pointer items-center gap-3">
              <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                <input
                  id="wizard-mature"
                  type="checkbox"
                  role="switch"
                  checked={mature}
                  onChange={(e) => setMature(e.target.checked)}
                  className="peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ember-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
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
          </div>
        ) : (
          <div className="mt-5">
            <h3 className="font-display text-lg tracking-tight text-parchment">
              Illustration style
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              How the artwork will look. You can change this later in book settings.
            </p>
            <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Illustration style">
              {styles.length === 0 ? (
                <p className="text-sm text-stone-500">Loading styles…</p>
              ) : (
                styles.map((s) => {
                  const selected = s.id === styleId;
                  return (
                    <label
                      key={s.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                        selected
                          ? 'border-ember-400/60 bg-ember-400/10 text-parchment'
                          : 'border-stone-700/70 bg-stone-950/40 text-stone-300 hover:border-stone-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="wizard-style"
                        checked={selected}
                        onChange={() => setStyleId(s.id)}
                        className="h-4 w-4 accent-ember-400 focus-visible:ring-2 focus-visible:ring-ember-400/60"
                      />
                      {s.name}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (stepIdx === 0 ? onCancel() : setStepIdx((i) => i - 1))}
            disabled={submitting}
            className="rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-300 transition hover:bg-stone-800 disabled:opacity-60"
          >
            {stepIdx === 0 ? 'Cancel' : 'Back'}
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={() => void finish()}
              disabled={submitting}
              className="rounded-full bg-ember-400 px-5 py-1.5 text-sm font-semibold text-stone-950 transition hover:bg-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Starting…' : 'Finish & generate'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStepIdx((i) => i + 1)}
              className="rounded-full bg-ember-400 px-5 py-1.5 text-sm font-semibold text-stone-950 transition hover:bg-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
