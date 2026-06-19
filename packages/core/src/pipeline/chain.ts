import { getQueue as defaultGetQueue, type QueueName, type StageJobPayload } from '../queues';

/**
 * The linear pipeline, in stage order. A book uploaded through the wizard runs
 * this whole chain end-to-end with no manual gates: each stage, on success,
 * enqueues the next (see `enqueueNextStage`). The two historical manual gates —
 * segment→analyze ("run analysis") and profiles→imagine ("generate art") — are
 * now just links in this chain.
 */
export const PIPELINE_ORDER = ['ingest', 'segment', 'analyze', 'profiles', 'imagine'] as const;

export type PipelineStage = (typeof PIPELINE_ORDER)[number];

/**
 * The stage that runs after `stage` on success, or null when `stage` is the
 * terminal stage (imagine). Pure — the single source of truth for the
 * auto-chain order.
 */
export function nextStage(stage: PipelineStage): PipelineStage | null {
  const i = PIPELINE_ORDER.indexOf(stage);
  return PIPELINE_ORDER[i + 1] ?? null;
}

/**
 * Whether a finished `profiles` stage should auto-chain into `imagine`. True
 * only when profiles ran as part of the full pipeline (the `autoChain` flag set
 * by analyze when it enqueues profiles). A standalone "Rebuild profiles" re-run
 * leaves it unset and stops at profiles — no surprise full re-paint.
 */
export function shouldChainProfilesToImagine(payload: { autoChain?: boolean }): boolean {
  return payload.autoChain === true;
}

/** Minimal Queue shape `enqueueNextStage` needs (just `add`). */
interface AddableQueue {
  add(name: string, payload: StageJobPayload): Promise<unknown>;
}

export interface EnqueueNextStageOptions {
  /** Injectable for tests; defaults to the real BullMQ queue factory. */
  getQueue?: (name: QueueName) => AddableQueue;
}

/**
 * Enqueues the successor of `stage` (same bookId/runId), returning the stage
 * that was enqueued — or null when `stage` is terminal and nothing was
 * enqueued. Call this at the END of a stage, after its work succeeded and the
 * run is still the book's latest (the caller already passed any supersede
 * fence), so the whole pipeline auto-chains from the wizard's single Finish.
 */
export async function enqueueNextStage(
  stage: PipelineStage,
  payload: StageJobPayload,
  options: EnqueueNextStageOptions = {},
): Promise<PipelineStage | null> {
  const next = nextStage(stage);
  if (!next) return null;
  const getQueue = options.getQueue ?? (defaultGetQueue as (name: QueueName) => AddableQueue);
  await getQueue(next).add(next, { bookId: payload.bookId, runId: payload.runId });
  return next;
}
