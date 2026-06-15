'use client';

import type { PipelineRunStatus } from '@vividpages/db';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FailedImage, JobRun, JobsData } from '@/lib/queries';

/** Human label per pipeline stage (client-safe copy of the server map). */
const STAGE_LABELS: Record<string, string> = {
  ingest: 'Ingest',
  segment: 'Segment',
  analyze: 'Analyze',
  profiles: 'Profiles',
  imagine: 'Imagine',
};

/** Stages whose token tallies are meaningful (mirrors LLM_STAGES, client-safe). */
const LLM_STAGES = new Set(['analyze', 'profiles']);

/** Poll cadence while any run is active. */
const POLL_MS = 3000;

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** 'Analyze' → portrait / scene wording for failed images. */
function imageKindLabel(kind: FailedImage['kind']): string {
  if (kind === 'character_portrait') return 'Portrait';
  if (kind === 'scene_storyboard') return 'Scene';
  return 'Cover';
}

/** Compact thousands: 241769 → '241.8k'. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** '1m 24s' / '45s' from two ISO timestamps. */
function fmtDuration(startIso: string, endIso: string): string {
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** 'Jun 15, 09:00' from an ISO timestamp. */
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_STYLES: Record<PipelineRunStatus, string> = {
  running: 'border-ember-400/40 bg-ember-400/10 text-ember-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
};

function StatusBadge({ status }: { status: PipelineRunStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

/** A long error message, truncated with a click-to-expand toggle. */
function ExpandableError({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  const long = error.length > 90;
  return (
    <button
      type="button"
      onClick={() => long && setOpen((v) => !v)}
      className={`mt-1 max-w-full text-left text-xs leading-snug text-red-300/90 ${
        long ? 'cursor-pointer hover:text-red-200' : 'cursor-default'
      } ${open ? '' : 'line-clamp-2'}`}
      title={long ? (open ? 'Click to collapse' : 'Click to expand') : undefined}
    >
      {error}
    </button>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
      <div
        className="h-full rounded-full bg-ember-400 transition-[width] duration-700 ease-out"
        style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
      />
    </div>
  );
}

function ActiveRunCard({ run }: { run: JobRun }) {
  return (
    <div
      className="rounded-xl border border-ember-400/30 bg-stone-900/50 p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/books/${run.bookId}`}
          className="truncate font-display text-base text-parchment transition hover:text-ember-300"
        >
          {run.bookTitle}
        </Link>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.2em] text-ember-300">
          {stageLabel(run.stage)}
        </span>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="truncate text-xs text-stone-500">{run.currentStep ?? 'Working…'}</p>
        <p className="shrink-0 text-xs tabular-nums text-stone-400">{Math.round(run.percent)}%</p>
      </div>
      <div className="mt-2">
        <ProgressBar percent={run.percent} />
      </div>
    </div>
  );
}

function HistoryRow({
  run,
  onRetry,
  retrying,
}: {
  run: JobRun;
  onRetry: (runId: string) => void;
  retrying: boolean;
}) {
  const showTokens = LLM_STAGES.has(run.stage) && (run.tokensIn > 0 || run.tokensOut > 0);
  const retryable =
    run.status === 'failed' &&
    (run.stage === 'analyze' || run.stage === 'profiles' || run.stage === 'imagine');

  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/books/${run.bookId}`}
            className="truncate font-medium text-parchment transition hover:text-ember-300"
          >
            {run.bookTitle}
          </Link>
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-stone-500">
            {stageLabel(run.stage)}
          </span>
          <StatusBadge status={run.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-stone-500">
          <span title={fmtWhen(run.updatedAt)}>{fmtWhen(run.startedAt)}</span>
          <span className="tabular-nums">{fmtDuration(run.startedAt, run.updatedAt)}</span>
          {showTokens ? (
            <span className="tabular-nums text-stone-400">
              {fmtTokens(run.tokensIn)} in · {fmtTokens(run.tokensOut)} out
            </span>
          ) : null}
        </div>
        {run.status === 'failed' && run.error ? <ExpandableError error={run.error} /> : null}
      </div>
      {retryable ? (
        <div className="sm:pt-0.5">
          <button
            type="button"
            onClick={() => onRetry(run.id)}
            disabled={retrying}
            className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300 transition hover:border-ember-400/60 hover:text-ember-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function FailedImageRow({
  img,
  onRetry,
  retrying,
}: {
  img: FailedImage;
  onRetry: (imageId: string) => void;
  retrying: boolean;
}) {
  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/books/${img.bookId}`}
            className="truncate font-medium text-parchment transition hover:text-ember-300"
          >
            {img.bookTitle}
          </Link>
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-stone-500">
            {imageKindLabel(img.kind)}
            {img.subjectName ? ` · ${img.subjectName}` : ''}
          </span>
        </div>
        {img.error ? <ExpandableError error={img.error} /> : null}
      </div>
      <div className="sm:pt-0.5">
        <button
          type="button"
          onClick={() => onRetry(img.id)}
          disabled={retrying}
          className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300 transition hover:border-ember-400/60 hover:text-ember-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </li>
  );
}

function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-display text-lg tracking-tight text-parchment">{title}</h2>
        {count != null ? <span className="text-xs tabular-nums text-stone-600">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The interactive jobs view: renders the server's initial snapshot, polls
 * GET /api/jobs every few seconds while any run is active (so active runs
 * advance and finished ones drop into history without a manual refresh), and
 * fires retries for failed runs (POST /api/jobs) and failed images
 * (POST /api/images/[id]/regenerate).
 */
export function JobsDashboard({ initialData }: { initialData: JobsData }) {
  const [data, setData] = useState<JobsData>(initialData);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = data.runs.filter((r) => r.active);
  const history = data.runs;
  const hasActive = active.length > 0;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      setData((await res.json()) as JobsData);
    } catch {
      // Transient; the next tick (or a manual action) retries.
    }
  }, []);

  // Poll while a run is active so the dashboard reflects progress live.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void refreshRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive]);

  async function post(url: string, body: unknown, id: string) {
    setRetryingId(id);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 202) {
        await refresh();
        return;
      }
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? 'Could not start the retry. Please try again.');
    } catch {
      setError('Could not start the retry. Check your connection and try again.');
    } finally {
      setRetryingId(null);
    }
  }

  const retryRun = (runId: string) => void post('/api/jobs', { runId }, runId);
  const retryImage = (imageId: string) =>
    void post(`/api/images/${imageId}/regenerate`, {}, imageId);

  const { tokensIn, tokensOut } = data.totals;
  const isEmpty = history.length === 0 && data.failedImages.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-stone-800 bg-stone-900/30 px-6 py-16 text-center">
        <p className="font-display text-lg text-parchment">No jobs yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-stone-500">
          When you analyze a book or generate its artwork, every run shows up here — live progress,
          history, and anything that needs a retry.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-full bg-ember-400 px-4 py-1.5 text-sm font-semibold text-stone-950 transition hover:bg-ember-300"
        >
          Go to your library
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {error ? (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {/* Cost / token summary */}
      <section
        aria-label="Token usage"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-800/70 bg-stone-800/40 sm:grid-cols-4"
      >
        {[
          { label: 'Active', value: String(active.length) },
          { label: 'Total runs', value: String(history.length) },
          { label: 'Tokens in', value: fmtTokens(tokensIn) },
          { label: 'Tokens out', value: fmtTokens(tokensOut) },
        ].map((stat) => (
          <div key={stat.label} className="bg-stone-900/50 px-4 py-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-600">
              {stat.label}
            </p>
            <p className="mt-1 font-display text-2xl tabular-nums text-parchment">{stat.value}</p>
          </div>
        ))}
        <p className="col-span-full bg-stone-900/50 px-4 pb-3 text-[11px] text-stone-600">
          Token tallies cover LLM stages (analyze &amp; profiles) only — image generation is not
          metered here.
        </p>
      </section>

      {hasActive ? (
        <SectionCard title="Active" count={active.length}>
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((run) => (
              <ActiveRunCard key={run.id} run={run} />
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="History" count={history.length}>
        {history.length === 0 ? (
          <p className="rounded-xl border border-stone-800/70 bg-stone-900/30 px-4 py-6 text-sm text-stone-500">
            No completed runs yet.
          </p>
        ) : (
          <ul className="divide-y divide-stone-800/60 overflow-hidden rounded-xl border border-stone-800/70 bg-stone-900/30">
            {history.map((run) => (
              <HistoryRow
                key={run.id}
                run={run}
                onRetry={retryRun}
                retrying={retryingId === run.id}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {data.failedImages.length > 0 ? (
        <SectionCard title="Failed artwork" count={data.failedImages.length}>
          <ul className="divide-y divide-stone-800/60 overflow-hidden rounded-xl border border-red-500/20 bg-stone-900/30">
            {data.failedImages.map((img) => (
              <FailedImageRow
                key={img.id}
                img={img}
                onRetry={retryImage}
                retrying={retryingId === img.id}
              />
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
