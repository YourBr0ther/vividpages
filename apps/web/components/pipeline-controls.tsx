'use client';

import type { BookStatus } from '@vividpages/db';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { STATUS_LABELS, isTerminalStatus } from '@/lib/book-card-data';
import { useBookProgress } from '@/lib/use-book-progress';

import { ConfirmDialog } from './confirm-dialog';

type PipelineAction = 'analyze' | 'profiles' | 'imagine';

interface PipelineControlsProps {
  bookId: string;
  /** Book status at render time (live SSE values take over once subscribed). */
  status: BookStatus;
  /** True when the latest run is live (running + recent heartbeat). */
  initiallyActive: boolean;
  /** The book's failure message, when status is 'failed'. */
  initialError: string | null;
  analyzedScenes: number;
  totalScenes: number;
  characterCount: number;
  /** Characters eligible for a portrait (significant role + appearance token). */
  portraitCount: number;
  /** Resolved provider/model (book → user settings → defaults), display-only. */
  provider: string;
  model: string;
}

/** Idle-state copy for the card, stage-appropriate. */
function idleCopy(props: PipelineControlsProps): string {
  const { status, analyzedScenes, totalScenes, characterCount } = props;
  if (status === 'failed') {
    return 'The last run failed. You can start it again from here.';
  }
  if (analyzedScenes === 0) {
    return 'The text is segmented and ready. Run the analysis to study every scene and discover the cast.';
  }
  const scenes =
    analyzedScenes >= totalScenes
      ? `All ${totalScenes} scenes analyzed`
      : `${analyzedScenes} of ${totalScenes} scenes analyzed`;
  return `${scenes} · ${characterCount} character${characterCount === 1 ? '' : 's'} catalogued.`;
}

/** Rough per-image wall-clock for the art-time estimate. */
const SECONDS_PER_IMAGE = 15;

/** '~3 minutes' / '~45 seconds' for n images at ~15s each. */
function artTimeEstimate(imageCount: number): string {
  const seconds = imageCount * SECONDS_PER_IMAGE;
  if (seconds < 90) return `~${seconds} seconds`;
  return `~${Math.ceil(seconds / 60)} minutes`;
}

function confirmCopy(
  action: PipelineAction,
  props: PipelineControlsProps,
): { title: string; body: string; confirm: string } {
  if (action === 'imagine') {
    const { portraitCount, analyzedScenes } = props;
    const total = portraitCount + analyzedScenes;
    return {
      title: 'Generate the artwork?',
      body:
        `This will paint about ${portraitCount} character portrait${portraitCount === 1 ? '' : 's'} ` +
        `and ${analyzedScenes} scene illustration${analyzedScenes === 1 ? '' : 's'} — ` +
        `roughly ${artTimeEstimate(total)} at ~${SECONDS_PER_IMAGE}s per image. ` +
        'Subjects that already have finished art are skipped.',
      confirm: 'Generate art',
    };
  }
  if (action === 'profiles') {
    return {
      title: 'Rebuild the character profiles?',
      body: 'Profiles, roles, and appearance tokens will be recomputed from the existing scene analysis, replacing the current ones.',
      confirm: 'Rebuild',
    };
  }
  return {
    title: 'Re-run the analysis?',
    body: 'Re-analysis will rebuild scene insights and the cast from scratch. This reads the whole book again and can take a while.',
    confirm: 'Re-analyze',
  };
}

/**
 * The 'Analysis & illustration' card: stage-appropriate status copy, live SSE
 * progress while a run is active, and the buttons that start pipeline runs
 * (POST /api/books/[id]/pipeline). Destructive re-runs confirm first.
 */
export function PipelineControls(props: PipelineControlsProps) {
  const { bookId, initiallyActive, initialError, analyzedScenes, characterCount, provider, model } =
    props;
  const router = useRouter();

  // `subscribed` means "we believe a run is active": set on mount when the
  // server saw one, and after a 202 from the pipeline route. Cleared (with a
  // server-data refresh) once SSE reports a terminal status.
  const [subscribed, setSubscribed] = useState(initiallyActive);
  const [confirming, setConfirming] = useState<PipelineAction | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = useBookProgress(bookId, { enabled: subscribed });
  const status = progress.status ?? props.status;
  // Until the first SSE event lands, trust `subscribed` (the POST already
  // succeeded / the server already saw a live run).
  const running = subscribed && (progress.status === null || !isTerminalStatus(progress.status));

  useEffect(() => {
    if (subscribed && progress.status && isTerminalStatus(progress.status)) {
      setSubscribed(false);
      router.refresh();
    }
  }, [subscribed, progress.status, router]);

  async function start(action: PipelineAction) {
    setPosting(true);
    setError(null);
    try {
      const force =
        action === 'profiles' || (action === 'analyze' && analyzedScenes > 0);
      const res = await fetch(`/api/books/${bookId}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, force }),
      });
      if (res.status === 202) {
        setSubscribed(true);
        router.refresh();
        return;
      }
      if (res.status === 409) {
        // Either a run is already active (subscribe and show it) or a
        // precondition failed; the server's message covers both.
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setSubscribed(true);
        setError(data?.error ?? 'A pipeline run is already in progress.');
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? 'Could not start the run. Please try again.');
    } catch {
      setError('Could not start the run. Check your connection and try again.');
    } finally {
      setPosting(false);
      setConfirming(null);
    }
  }

  function requestAnalyze() {
    // Overwrite guard: re-analysis rebuilds existing scene insights + cast.
    if (analyzedScenes > 0) setConfirming('analyze');
    else void start('analyze');
  }

  const buttonsDisabled = running || posting;
  const failed = !running && status === 'failed';
  const liveError = progress.error ?? initialError;

  return (
    <section
      aria-label="Analysis and illustration"
      className="rounded-xl border border-stone-800/70 bg-stone-900/40 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg tracking-tight text-parchment">
          Analysis &amp; illustration
        </h2>
        {running ? (
          <span className="shrink-0 rounded-full border border-ember-400/40 bg-ember-400/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-ember-300">
            Running
          </span>
        ) : null}
      </div>

      {running ? (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ember-300">
              {STATUS_LABELS[status]}
            </p>
            <p className="text-xs tabular-nums text-stone-400">
              {progress.percent != null ? `${Math.round(progress.percent)}%` : '…'}
            </p>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-800">
            <div
              className="h-full rounded-full bg-ember-400 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.min(100, Math.max(2, progress.percent ?? 2))}%` }}
            />
          </div>
          {progress.currentStep ? (
            <p className="mt-2 line-clamp-2 text-xs leading-snug text-stone-500">
              {progress.currentStep}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-500">{idleCopy(props)}</p>
          {failed && liveError ? (
            <p role="alert" className="mt-2 line-clamp-3 text-xs leading-snug text-red-300">
              {liveError}
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={requestAnalyze}
          disabled={buttonsDisabled}
          className="rounded-full bg-ember-400 px-4 py-1.5 text-sm font-semibold text-stone-950 transition hover:bg-ember-300 focus-visible:ring-2 focus-visible:ring-ember-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Run analysis
        </button>
        {characterCount > 0 ? (
          <button
            type="button"
            onClick={() => setConfirming('profiles')}
            disabled={buttonsDisabled}
            className="rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-300 transition hover:border-stone-600 hover:text-parchment focus-visible:ring-2 focus-visible:ring-ember-400/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rebuild profiles
          </button>
        ) : null}
        {analyzedScenes > 0 ? (
          <button
            type="button"
            onClick={() => setConfirming('imagine')}
            disabled={buttonsDisabled || status !== 'ready'}
            title={status !== 'ready' ? 'Available once the book is ready' : undefined}
            className="rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-300 transition hover:border-stone-600 hover:text-parchment focus-visible:ring-2 focus-visible:ring-ember-400/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Generate art
          </button>
        ) : null}
      </div>

      {/* Provider/model slot: read-only until the T28 settings UI lands. */}
      <dl className="mt-5 flex items-center justify-between gap-3 border-t border-stone-800/70 pt-3">
        <dt className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-600">
          Engine
        </dt>
        <dd className="truncate text-xs text-stone-400">
          {provider} · {model}
        </dd>
      </dl>

      {confirming ? (
        <ConfirmDialog
          title={confirmCopy(confirming, props).title}
          body={confirmCopy(confirming, props).body}
          confirmLabel={confirmCopy(confirming, props).confirm}
          busyLabel="Starting…"
          busy={posting}
          onConfirm={() => void start(confirming)}
          onCancel={() => {
            if (!posting) setConfirming(null);
          }}
        />
      ) : null}
    </section>
  );
}
