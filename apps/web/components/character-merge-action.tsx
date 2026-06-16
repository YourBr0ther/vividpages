'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import type { CastMember } from '@/lib/queries';

import { ConfirmDialog } from './confirm-dialog';
import { ToastViewport, useToasts } from './toasts';

/** Minimal shape this control needs from a candidate merge target. */
export type MergeTarget = Pick<CastMember, 'id' | 'name'>;

/**
 * The per-card "Merge into…" affordance. THIS card is the one to ABSORB; the
 * user picks one of the OTHER characters as the surviving primary. On confirm
 * we POST the merge, toast the result, and refresh the cast list.
 *
 * Mirrors the sibling Character-LoRA disclosure on the same card — a quiet
 * ember-glyph summary opening an inset panel — so the two secondary actions
 * read as a matched pair beneath the portrait. The absorbed character's portrait
 * is dropped and its scenes re-illustrate, so the action is gated behind the
 * shared accessible ConfirmDialog (destructive, can't be undone) and disabled
 * while the request is in flight.
 */
export function CharacterMergeAction({
  bookId,
  character,
  targets,
}: {
  bookId: string;
  /** The character this card represents — the one to absorb. */
  character: MergeTarget & { sceneCount: number };
  /** The other characters in the book, offered as primaries. */
  targets: MergeTarget[];
}) {
  const router = useRouter();
  const { toasts, pushToast, dismissToast } = useToasts();
  const selectId = useId();
  const hintId = `${selectId}-hint`;

  const [primaryId, setPrimaryId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const primary = targets.find((t) => t.id === primaryId) ?? null;

  // Nothing to merge into when this is the only character in the book.
  if (targets.length === 0) return null;

  async function confirmMerge() {
    if (!primary || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/books/${bookId}/characters/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keepId: primary.id, absorbId: character.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { regenerating?: number; note?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? 'Could not merge these characters.');
      }
      const regenerating = data?.regenerating ?? 0;
      pushToast(
        'info',
        data?.note
          ? `Merged into ${primary.name}; ${data.note}.`
          : `Merged into ${primary.name}; ${regenerating} ${
              regenerating === 1 ? 'scene is' : 'scenes are'
            } re-illustrating.`,
      );
      setConfirming(false);
      setPrimaryId('');
      router.refresh();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not merge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group/merge -mx-1 mt-1 rounded-md px-1">
      <summary className="flex cursor-pointer select-none items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-600 transition hover:text-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70">
        <span aria-hidden className="text-ember-400/70">
          ⤳
        </span>
        Merge into…
      </summary>

      <div className="mt-2 space-y-3 rounded-md border border-stone-800/70 bg-stone-950/50 p-3">
        <div className="space-y-1">
          <label
            htmlFor={selectId}
            className="block text-[10px] uppercase tracking-[0.18em] text-stone-500"
          >
            Surviving character
          </label>
          <select
            id={selectId}
            value={primaryId}
            onChange={(e) => setPrimaryId(e.target.value)}
            disabled={busy}
            aria-describedby={hintId}
            className="w-full rounded-md border border-stone-700 bg-stone-900/70 px-2 py-1.5 text-xs text-parchment focus:border-ember-400/60 focus:outline-none focus:ring-1 focus:ring-ember-400/40 disabled:opacity-50"
          >
            <option value="">Choose a character…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p id={hintId} className="text-[10px] leading-snug text-stone-600">
            {character.name} is absorbed into the chosen character — its portrait is dropped and its
            scenes re-illustrate.
          </p>
        </div>

        <div className="flex justify-end pt-0.5">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!primary || busy}
            className="shrink-0 rounded-full border border-ember-400/40 bg-ember-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-ember-300 transition hover:bg-ember-400/20 focus-visible:ring-2 focus-visible:ring-ember-400/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Merge
          </button>
        </div>
      </div>

      {confirming && primary ? (
        <ConfirmDialog
          title="Merge characters?"
          body={`Absorb ${character.name} into ${primary.name}. ${character.name}'s portrait is removed and its ${character.sceneCount} ${
            character.sceneCount === 1 ? 'scene' : 'scenes'
          } will be re-illustrated. This can't be undone.`}
          confirmLabel="Merge"
          busyLabel="Merging…"
          busy={busy}
          onConfirm={confirmMerge}
          onCancel={() => {
            if (!busy) setConfirming(false);
          }}
        />
      ) : null}

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </details>
  );
}
