'use client';

import { useState } from 'react';

/**
 * The minor "Upgrade to full wardrobe" control (Phase 2, chunk 6). A minor
 * character normally gets only a body model + single base outfit; upgrading
 * promotes them to the full wardrobe (multiple appearance states), which is
 * extracted + rendered on the NEXT pipeline run — there is no live per-character
 * regeneration here. The button just persists the flag via
 * `PATCH /api/characters/[id]` (auth + book-ownership server-side); the UI then
 * reflects "Upgraded — pending next run".
 */
export function WardrobeUpgradeToggle({
  characterId,
  characterName,
  initialUpgraded,
}: {
  characterId: string;
  characterName: string;
  initialUpgraded: boolean;
}) {
  const [upgraded, setUpgraded] = useState(initialUpgraded);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    if (upgraded || saving) return;
    setError(null);
    setSaving(true);
    // Optimistic: flip immediately, revert on failure.
    setUpgraded(true);
    try {
      const res = await fetch(`/api/characters/${characterId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wardrobeUpgraded: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Could not upgrade the wardrobe.');
      }
    } catch (err) {
      setUpgraded(false);
      setError(err instanceof Error ? err.message : 'Could not upgrade.');
    } finally {
      setSaving(false);
    }
  }

  if (upgraded) {
    return (
      <div className="mt-1 rounded-md border border-ember-400/30 bg-ember-400/5 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-ember-300">
          <span aria-hidden>✦</span>
          Upgraded
        </p>
        <p className="mt-1 text-[10px] leading-snug text-stone-500">
          {characterName}&rsquo;s full wardrobe will be generated on the next run.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-2 rounded-md border border-stone-800/70 bg-stone-950/50 px-3 py-2">
      <p className="text-[10px] leading-snug text-stone-500">
        Minor characters get a body model + base outfit. Upgrade to extract the full
        wardrobe — it will be generated on the next run.
      </p>
      {error ? (
        <p role="alert" className="text-[11px] text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={upgrade}
        disabled={saving}
        className="w-full rounded-full border border-ember-400/40 bg-ember-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-ember-300 transition hover:bg-ember-400/20 focus-visible:ring-2 focus-visible:ring-ember-400/70 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? 'Upgrading…' : 'Upgrade to full wardrobe'}
      </button>
    </div>
  );
}
