'use client';

import { useEffect, useId, useRef, useState } from 'react';

/** Z-Image guidance keeps strength in 0–1.5; 1.0 is the sensible default. */
const MIN_STRENGTH = 0;
const MAX_STRENGTH = 1.5;
const STRENGTH_STEP = 0.05;
const DEFAULT_STRENGTH = 1.0;

/** The "no LoRA" sentinel for the <select> (empty option value). */
const NONE = '';

type LoraDiscovery = { loras: string[]; available: boolean };

/** The fields the panel reflects and patches; mirrors the character columns. */
type LoraState = {
  loraName: string | null;
  loraKeyword: string | null;
  loraStrength: number | null;
};

function clampStrength(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_STRENGTH;
  return Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, value));
}

/**
 * The per-character LoRA config (issue #2), folded into a card disclosure so it
 * stays secondary to the portrait. On open it discovers the installed LoRAs from
 * `GET /api/loras`: when ComfyUI is reachable it offers a searchable picker of
 * filenames + "None"; when it isn't, it degrades to a free-text filename field.
 * Saves are optimistic via `PATCH /api/characters/[id]` and revert on error.
 */
export function CharacterLoraConfig({
  characterId,
  characterName,
  initial,
}: {
  characterId: string;
  characterName: string;
  initial: LoraState;
}) {
  // The persisted truth (what's in the DB); committed state reverts to this.
  const [committed, setCommitted] = useState<LoraState>(initial);
  // The in-flight edit buffer the inputs bind to.
  const [draft, setDraft] = useState<LoraState>(initial);

  const [discovery, setDiscovery] = useState<LoraDiscovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fetchedRef = useRef(false);

  const baseId = useId();
  const nameFieldId = `${baseId}-name`;
  const keywordFieldId = `${baseId}-keyword`;
  const strengthFieldId = `${baseId}-strength`;
  const listId = `${baseId}-loralist`;

  // Discover LoRAs once, lazily, the first time the panel is opened.
  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    setDiscovering(true);
    let cancelled = false;
    fetch('/api/loras')
      .then((res) => (res.ok ? res.json() : { loras: [], available: false }))
      .then((data: LoraDiscovery) => {
        if (!cancelled) setDiscovery(data);
      })
      .catch(() => {
        if (!cancelled) setDiscovery({ loras: [], available: false });
      })
      .finally(() => {
        if (!cancelled) setDiscovering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const hasLora = Boolean(draft.loraName && draft.loraName.trim());
  const dirty =
    draft.loraName !== committed.loraName ||
    draft.loraKeyword !== committed.loraKeyword ||
    draft.loraStrength !== committed.loraStrength;

  function setName(raw: string) {
    setError(null);
    const value = raw.trim() ? raw.trim() : null;
    setDraft((d) => ({
      loraName: value,
      // Clearing to "None" also clears the keyword + strength.
      loraKeyword: value ? d.loraKeyword : null,
      loraStrength: value ? (d.loraStrength ?? DEFAULT_STRENGTH) : null,
    }));
  }

  async function save() {
    if (!dirty || saving) return;
    setError(null);
    setSaving(true);

    // Normalize the payload: "None" clears everything; an active LoRA keeps a
    // concrete strength so the slider and the recorded params stay in sync.
    const payload: LoraState = draft.loraName
      ? {
          loraName: draft.loraName,
          loraKeyword: draft.loraKeyword?.trim() ? draft.loraKeyword.trim() : null,
          loraStrength: clampStrength(draft.loraStrength ?? DEFAULT_STRENGTH),
        }
      : { loraName: null, loraKeyword: null, loraStrength: null };

    // Optimistic: show the new values as committed immediately, revert on error.
    const previous = committed;
    setCommitted(payload);
    setDraft(payload);

    try {
      const res = await fetch(`/api/characters/${characterId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Could not save the LoRA settings.');
      }
    } catch (err) {
      setCommitted(previous);
      setDraft(previous);
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const strength = draft.loraStrength ?? DEFAULT_STRENGTH;

  return (
    <details
      className="group/lora -mx-1 mt-1 rounded-md px-1"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-stone-600 transition hover:text-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70">
        <span aria-hidden className="text-ember-400/70">
          ✦
        </span>
        Character LoRA
        {committed.loraName ? (
          <span
            className="truncate rounded-full border border-ember-400/30 bg-ember-400/10 px-1.5 py-px text-[9px] normal-case tracking-normal text-ember-300"
            title={committed.loraName}
          >
            on
          </span>
        ) : null}
      </summary>

      <div className="mt-2 space-y-3 rounded-md border border-stone-800/70 bg-stone-950/50 p-3">
        {/* LoRA selector --------------------------------------------------- */}
        <div className="space-y-1">
          <label
            htmlFor={nameFieldId}
            className="block text-[10px] uppercase tracking-[0.18em] text-stone-500"
          >
            LoRA
          </label>

          {discovering ? (
            <p className="text-xs text-stone-500">Discovering installed LoRAs…</p>
          ) : discovery?.available ? (
            <>
              {/* Searchable: native datalist-backed input keeps it accessible
                  and compact while letting the user type-to-filter. */}
              <input
                id={nameFieldId}
                list={listId}
                value={draft.loraName ?? ''}
                placeholder="None"
                onChange={(e) => setName(e.target.value)}
                aria-describedby={`${nameFieldId}-hint`}
                className="w-full rounded-md border border-stone-700 bg-stone-900/70 px-2 py-1.5 font-mono text-xs text-parchment placeholder:text-stone-600 focus:border-ember-400/60 focus:outline-none focus:ring-1 focus:ring-ember-400/40"
              />
              <datalist id={listId}>
                {discovery.loras.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p id={`${nameFieldId}-hint`} className="text-[10px] text-stone-600">
                Leave blank for None. Type to search {discovery.loras.length} installed.
              </p>
            </>
          ) : (
            <>
              <input
                id={nameFieldId}
                value={draft.loraName ?? ''}
                placeholder="filename.safetensors"
                onChange={(e) => setName(e.target.value)}
                aria-describedby={`${nameFieldId}-hint`}
                className="w-full rounded-md border border-stone-700 bg-stone-900/70 px-2 py-1.5 font-mono text-xs text-parchment placeholder:text-stone-600 focus:border-ember-400/60 focus:outline-none focus:ring-1 focus:ring-ember-400/40"
              />
              <p id={`${nameFieldId}-hint`} className="text-[10px] text-amber-500/80">
                ComfyUI unreachable — type the filename. Leave blank for None.
              </p>
            </>
          )}
        </div>

        {/* Keyword + strength only matter with a LoRA set ------------------ */}
        <div className="space-y-1" hidden={!hasLora}>
          <label
            htmlFor={keywordFieldId}
            className="block text-[10px] uppercase tracking-[0.18em] text-stone-500"
          >
            Trigger keyword <span className="text-stone-600 normal-case">(optional)</span>
          </label>
          <input
            id={keywordFieldId}
            value={draft.loraKeyword ?? ''}
            placeholder="e.g. kariiina"
            onChange={(e) => {
              setError(null);
              const v = e.target.value;
              setDraft((d) => ({ ...d, loraKeyword: v.trim() ? v : null }));
            }}
            className="w-full rounded-md border border-stone-700 bg-stone-900/70 px-2 py-1.5 text-xs text-parchment placeholder:text-stone-600 focus:border-ember-400/60 focus:outline-none focus:ring-1 focus:ring-ember-400/40"
          />
        </div>

        <div className="space-y-1" hidden={!hasLora}>
          <div className="flex items-baseline justify-between">
            <label
              htmlFor={strengthFieldId}
              className="text-[10px] uppercase tracking-[0.18em] text-stone-500"
            >
              Strength
            </label>
            <span className="font-mono text-xs tabular-nums text-ember-300">
              {strength.toFixed(2)}
            </span>
          </div>
          <input
            id={strengthFieldId}
            type="range"
            min={MIN_STRENGTH}
            max={MAX_STRENGTH}
            step={STRENGTH_STEP}
            value={strength}
            aria-valuetext={strength.toFixed(2)}
            onChange={(e) => {
              setError(null);
              const v = clampStrength(Number(e.target.value));
              setDraft((d) => ({ ...d, loraStrength: v }));
            }}
            className="w-full accent-ember-400"
          />
        </div>

        {error ? (
          <p role="alert" className="text-[11px] text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <p className="text-[10px] leading-snug text-stone-600">
            Applies on {characterName}&rsquo;s next portrait/scene regeneration.
          </p>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="shrink-0 rounded-full border border-ember-400/40 bg-ember-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-ember-300 transition hover:bg-ember-400/20 focus-visible:ring-2 focus-visible:ring-ember-400/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </details>
  );
}
