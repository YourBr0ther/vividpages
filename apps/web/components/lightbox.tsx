'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Poll cadence + cap while a repaint is in flight. */
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

export type LightboxKind = 'character_portrait' | 'scene_storyboard';

interface VersionInfo {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

interface ImageMeta {
  id: string;
  version: number;
  status: string;
  prompt: string | null;
  negativePrompt: string | null;
  model: string | null;
  seed: string | null;
  params: unknown;
  width: number | null;
  height: number | null;
}

/** The generation params jsonb, narrowed to what the chips show. */
function paramNumber(params: unknown, key: 'steps' | 'cfg'): number | null {
  if (!params || typeof params !== 'object') return null;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <li className="inline-flex items-baseline gap-1.5 rounded-full border border-stone-800 bg-stone-950/60 px-2.5 py-0.5 text-[11px] text-stone-300">
      <span className="text-[9px] uppercase tracking-[0.15em] text-stone-500">{label}</span>
      <span className="font-mono">{value}</span>
    </li>
  );
}

/**
 * The print room: a museum-dim overlay shared by the Reader and the cast
 * gallery. Shows one illustration fit-contain over a blurred ink backdrop,
 * with a placard underneath — provenance chips (seed/steps/cfg/model/version),
 * the prompt behind small scrollable type, the negative prompt folded away,
 * a version stepper when older renditions exist, and a Regenerate button
 * that enqueues a single-subject repaint and polls until the new version
 * arrives. Self-contained: it fetches its own metadata and version list
 * lazily when opened. Escape/backdrop close; focus is trapped and restored.
 */
export function Lightbox({
  imageId,
  subject,
  title,
  width,
  height,
  onClose,
  onRegenerated,
}: {
  /** The image to open on (usually the latest done version). */
  imageId: string;
  /** What this image depicts — drives versions + regeneration. */
  subject: { kind: LightboxKind; id: string };
  /** Placard title, e.g. a character's name or "Scene 14". */
  title: string;
  width?: number | null;
  height?: number | null;
  onClose: () => void;
  /** Called when a repaint finishes, with the freshly painted version. */
  onRegenerated?: (image: { id: string; version: number }) => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const metaCacheRef = useRef<Map<string, ImageMeta>>(new Map());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [currentId, setCurrentId] = useState(imageId);
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [painting, setPainting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // ---- Dialog mechanics: initial focus, focus restore, Escape, trap -------

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    // Capture phase so the Reader's ←/→ chapter keys never see our events.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // ---- Lazy data: metadata for the shown version, the version list --------

  useEffect(() => {
    const cached = metaCacheRef.current.get(currentId);
    if (cached) {
      setMeta(cached);
      return;
    }
    setMeta(null);
    let cancelled = false;
    void fetch(`/api/images/${currentId}?meta=1`)
      .then((res) => (res.ok ? (res.json() as Promise<ImageMeta>) : null))
      .then((data) => {
        if (!data || cancelled) return;
        metaCacheRef.current.set(currentId, data);
        setMeta(data);
      })
      .catch(() => {
        // The placard just stays sparse; the image itself still shows.
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const fetchVersions = useCallback(async (): Promise<VersionInfo[] | null> => {
    try {
      const res = await fetch(`/api/images/by-subject/${subject.id}?kind=${subject.kind}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { versions: VersionInfo[] };
      return data.versions;
    } catch {
      return null;
    }
  }, [subject.id, subject.kind]);

  useEffect(() => {
    let cancelled = false;
    void fetchVersions().then((list) => {
      if (list && !cancelled) setVersions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchVersions]);

  // ---- Regenerate: enqueue, then poll until a NEW done version lands ------

  const showVersion = useCallback((id: string) => {
    setImageLoaded(false);
    setCurrentId(id);
  }, []);

  const regenerate = useCallback(async () => {
    setNote(null);
    let baseline = 0;
    for (const v of versions ?? []) baseline = Math.max(baseline, v.version);
    baseline = Math.max(baseline, meta?.version ?? 0);

    let response: Response;
    try {
      response = await fetch(`/api/images/${currentId}/regenerate`, { method: 'POST' });
    } catch {
      setNote('Couldn’t reach the studio — try again.');
      return;
    }
    if (response.status === 409) {
      setNote('Another pipeline run is already in progress for this book.');
      return;
    }
    if (!response.ok) {
      setNote('Couldn’t start the repaint — try again.');
      return;
    }

    setPainting(true);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const poll = async () => {
      const list = await fetchVersions();
      if (list) {
        setVersions(list);
        const fresh = list.find((v) => v.status === 'done' && v.version > baseline);
        if (fresh) {
          setPainting(false);
          showVersion(fresh.id);
          onRegenerated?.({ id: fresh.id, version: fresh.version });
          router.refresh();
          return;
        }
      }
      if (Date.now() > deadline) {
        setPainting(false);
        setNote('Still painting — this is taking longer than usual. Check back in a bit.');
        return;
      }
      pollTimerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }, [currentId, fetchVersions, meta, onRegenerated, router, showVersion, versions]);

  useEffect(() => () => clearTimeout(pollTimerRef.current), []);

  // ---- Derived placard data ------------------------------------------------

  const doneVersions = (versions ?? []).filter((v) => v.status === 'done');
  const currentDoneIdx = doneVersions.findIndex((v) => v.id === currentId);
  const olderVersion = currentDoneIdx >= 0 ? doneVersions[currentDoneIdx + 1] : undefined;
  const newerVersion = currentDoneIdx > 0 ? doneVersions[currentDoneIdx - 1] : undefined;

  const steps = paramNumber(meta?.params, 'steps');
  const cfg = paramNumber(meta?.params, 'cfg');
  const chips: Array<{ label: string; value: string }> = [];
  if (meta?.seed) chips.push({ label: 'seed', value: meta.seed });
  if (steps != null) chips.push({ label: 'steps', value: String(steps) });
  if (cfg != null) chips.push({ label: 'cfg', value: String(cfg) });
  if (meta?.model) chips.push({ label: 'model', value: meta.model });
  if (meta) chips.push({ label: 'version', value: `v${meta.version}` });

  const aspectWidth = meta?.width ?? width ?? 3;
  const aspectHeight = meta?.height ?? height ?? 2;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Illustration — ${title}`}
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center p-4 sm:p-6"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-stone-950/85 backdrop-blur-md"
      />

      <div className="relative flex max-h-full w-full max-w-4xl min-h-0 flex-col animate-toast-in">
        {/* Placard header */}
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.3em] text-parchment/80">
            {title}
          </p>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-700 text-lg text-stone-300 transition hover:bg-stone-800 hover:text-parchment focus-visible:ring-2 focus-visible:ring-ember-400/70"
          >
            ×
          </button>
        </div>

        {/* The plate: aspect-ratio sized up front so the placard never jumps. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md bg-stone-950/50 ring-1 ring-parchment/15 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)]"
            style={{
              aspectRatio: `${aspectWidth} / ${aspectHeight}`,
              width: `min(100%, calc(62vh * ${aspectWidth / aspectHeight}))`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={currentId}
              src={`/api/images/${currentId}`}
              alt={`Illustration — ${title}`}
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              className={`h-full w-full object-contain transition-opacity duration-300 motion-reduce:transition-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
            {painting ? (
              <div className="absolute inset-0 flex items-center justify-center bg-stone-950/55 backdrop-blur-[2px]">
                <span className="animate-pulse rounded-full border border-ember-400/40 bg-stone-950/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-ember-300 motion-reduce:animate-none">
                  Painting…
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Placard body */}
        <div className="mt-4 rounded-xl border border-stone-800 bg-stone-900/90 p-4 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {chips.length > 0 ? (
              <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                  <Chip key={chip.label} label={chip.label} value={chip.value} />
                ))}
              </ul>
            ) : (
              <span className="text-xs text-stone-600">{meta ? '' : 'Loading details…'}</span>
            )}

            <div className="flex shrink-0 items-center gap-2">
              {doneVersions.length > 1 ? (
                <span className="flex items-center gap-1 rounded-full border border-stone-800 bg-stone-950/60 px-1 py-0.5">
                  <button
                    type="button"
                    onClick={() => olderVersion && showVersion(olderVersion.id)}
                    disabled={!olderVersion || painting}
                    aria-label="Older version"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-800 hover:text-parchment disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ember-400/70"
                  >
                    ‹
                  </button>
                  <span className="px-0.5 text-[11px] tabular-nums text-stone-400">
                    {doneVersions.length - Math.max(currentDoneIdx, 0)} / {doneVersions.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => newerVersion && showVersion(newerVersion.id)}
                    disabled={!newerVersion || painting}
                    aria-label="Newer version"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-800 hover:text-parchment disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ember-400/70"
                  >
                    ›
                  </button>
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={painting}
                className="rounded-full bg-ember-400 px-4 py-1.5 text-xs font-semibold text-stone-950 shadow-[0_8px_24px_-10px_rgba(224,155,59,0.6)] transition hover:bg-ember-300 disabled:cursor-default disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ember-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950"
              >
                {painting ? 'Painting…' : 'Regenerate'}
              </button>
            </div>
          </div>

          {note ? (
            <p role="status" className="mt-3 text-xs leading-relaxed text-ember-300">
              {note}
            </p>
          ) : null}

          {meta?.prompt ? (
            <p className="mt-3 max-h-20 overflow-y-auto text-xs leading-relaxed text-stone-400">
              {meta.prompt}
            </p>
          ) : null}

          {meta?.negativePrompt ? (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[11px] uppercase tracking-[0.18em] text-stone-600 transition hover:text-stone-400 focus-visible:ring-2 focus-visible:ring-ember-400/70">
                Negative prompt
              </summary>
              <p className="mt-1.5 max-h-16 overflow-y-auto text-xs leading-relaxed text-stone-500">
                {meta.negativePrompt}
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
