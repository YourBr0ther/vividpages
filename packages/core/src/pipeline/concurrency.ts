/**
 * Bounded-concurrency runner for the imagine stage's generation phase.
 *
 * A single ComfyUI/GPU serializes the actual rendering, but the worker wastes
 * time between renders post-processing (sharp webp + thumb + 2 MinIO uploads +
 * DB write) while the GPU sits idle. Running a small sliding window of tasks
 * concurrently keeps the next prompt queued in ComfyUI so the GPU rolls
 * straight into it while a finished sibling post-processes on our side.
 *
 * The runner is a PURE helper (no IO, no imports) so it can be unit-tested hard
 * with a fake task: max-in-flight ≤ depth, every item runs when not aborted,
 * abort halts NEW launches but drains in-flight, a throwing task is isolated,
 * starts respect array order, depth=1 is sequential.
 */

/** The terminal state of a single work item, as the imagine stage sees it. */
export type Outcome = 'done' | 'failed' | 'systemic';

/** Hooks the caller uses to react to settled tasks and steer the runner. */
export interface ConcurrencyHooks<T> {
  /**
   * Called once per task that settled WITHOUT throwing, with its outcome and
   * the item. The caller updates shared counters here (completed/failed/
   * consecutiveSystemic) and may flip an abort flag.
   */
  onOutcome(outcome: Outcome, item: T): void;
  /**
   * Polled before launching each NEW item. Returning true stops launching new
   * items; in-flight tasks still drain to completion before the runner resolves.
   */
  shouldAbort(): boolean;
  /**
   * Called when a task's promise REJECTS (the task itself threw rather than
   * returning an Outcome). The rejection is isolated — it never rejects the
   * runner. Optional; if absent, throws are swallowed. The caller may rethrow
   * synchronously to surface a truly-unexpected error.
   */
  onError?(error: unknown, item: T): void;
}

/**
 * Runs `task` over `items` with at most `depth` concurrent invocations.
 *
 * Sliding window: launches up to `depth` tasks; as each settles, launches the
 * next item in array order until the plan is exhausted or `shouldAbort()`
 * returns true. Always awaits all in-flight tasks to drain before resolving.
 * Never rejects from a task throwing — a throw is routed to `hooks.onError`
 * (which may itself rethrow to abort the whole runner with that error).
 *
 * `depth` is clamped to at least 1.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  depth: number,
  task: (item: T, index: number) => Promise<Outcome>,
  hooks: ConcurrencyHooks<T>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(depth));
  let nextIndex = 0;
  const inFlight = new Set<Promise<void>>();

  const launch = (): void => {
    while (inFlight.size < limit && nextIndex < items.length && !hooks.shouldAbort()) {
      const index = nextIndex++;
      const item = items[index] as T;
      const p = task(item, index)
        .then((outcome) => {
          hooks.onOutcome(outcome, item);
        })
        .catch((error) => {
          // A task throwing must never reject the runner. Route it to onError;
          // the caller may rethrow synchronously to surface an unexpected error.
          hooks.onError?.(error, item);
        })
        .finally(() => {
          inFlight.delete(p);
        });
      inFlight.add(p);
    }
  };

  launch();
  // Drain: as each in-flight task settles, top the window back up (respecting
  // abort + depth) until nothing is in flight and nothing new can launch.
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    launch();
  }
}
