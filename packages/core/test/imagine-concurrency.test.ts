import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../src/pipeline/concurrency';

/** A promise plus its resolve handle, for deterministic step-by-step control. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('runWithConcurrency', () => {
  it('runs every item exactly once when there is no abort (depth 2)', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const seen: string[] = [];
    await runWithConcurrency(
      items,
      2,
      async (item) => {
        seen.push(item);
        return 'done' as const;
      },
      { onOutcome: () => {}, shouldAbort: () => false },
    );
    expect(seen.sort()).toEqual([...items].sort());
    expect(seen).toHaveLength(items.length);
  });

  it('reports each item to onOutcome with its outcome', async () => {
    const items = [1, 2, 3];
    const outcomes: Array<{ outcome: string; item: number }> = [];
    await runWithConcurrency(
      items,
      2,
      async (item) => (item === 2 ? ('failed' as const) : ('done' as const)),
      {
        onOutcome: (outcome, item) => outcomes.push({ outcome, item }),
        shouldAbort: () => false,
      },
    );
    expect(outcomes.sort((a, b) => a.item - b.item)).toEqual([
      { outcome: 'done', item: 1 },
      { outcome: 'failed', item: 2 },
      { outcome: 'done', item: 3 },
    ]);
  });

  it('never exceeds `depth` concurrent tasks', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const gates = items.map(() => deferred<void>());
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];

    const run = runWithConcurrency(
      items,
      3,
      async (item) => {
        started.push(item);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gates[item]!.promise;
        inFlight--;
        return 'done' as const;
      },
      { onOutcome: () => {}, shouldAbort: () => false },
    );

    // Let the initial window launch.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(inFlight).toBe(3);

    // Release one at a time; depth must hold.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlight).toBeLessThanOrEqual(3);
    }
    await run;
    expect(maxInFlight).toBe(3);
    expect(started.sort((a, b) => a - b)).toEqual(items);
  });

  it('starts items in array order', async () => {
    const items = ['x', 'y', 'z'];
    const starts: string[] = [];
    await runWithConcurrency(
      items,
      1,
      async (item) => {
        starts.push(item);
        return 'done' as const;
      },
      { onOutcome: () => {}, shouldAbort: () => false },
    );
    expect(starts).toEqual(items);
  });

  it('depth=1 behaves sequentially (one in flight at a time)', async () => {
    const items = [0, 1, 2, 3];
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrency(
      items,
      1,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return 'done' as const;
      },
      { onOutcome: () => {}, shouldAbort: () => false },
    );
    expect(maxInFlight).toBe(1);
  });

  it('abort stops launching NEW items but drains in-flight', async () => {
    const items = [0, 1, 2, 3, 4, 5];
    const gates = items.map(() => deferred<void>());
    const started: number[] = [];
    const settled: number[] = [];
    let aborted = false;

    const run = runWithConcurrency(
      items,
      2,
      async (item) => {
        started.push(item);
        await gates[item]!.promise;
        return 'done' as const;
      },
      {
        onOutcome: (_outcome, item) => {
          settled.push(item);
          // Trip the abort flag once item 0 settles.
          if (item === 0) aborted = true;
        },
        shouldAbort: () => aborted,
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    // Window of 2 launched: items 0 and 1.
    expect(started).toEqual([0, 1]);

    // Settle item 0 -> trips abort. Item 1 is still in flight and must drain;
    // no NEW item (2..) may launch.
    gates[0]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    // Drain item 1.
    gates[1]!.resolve();
    await run;

    expect(started).toEqual([0, 1]);
    expect(settled.sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('a task that throws is isolated (does not reject the runner) and reported', async () => {
    const items = [0, 1, 2];
    const outcomes: string[] = [];
    let caught: unknown;
    await expect(
      runWithConcurrency(
        items,
        2,
        async (item) => {
          if (item === 1) throw new Error('boom');
          return 'done' as const;
        },
        {
          onOutcome: (outcome) => outcomes.push(outcome),
          shouldAbort: () => false,
          onError: (err) => {
            caught = err;
          },
        },
      ),
    ).resolves.toBeUndefined();
    // Both surviving items ran; the throwing one was caught, not propagated.
    expect(outcomes.filter((o) => o === 'done')).toHaveLength(2);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
  });

  it('an empty plan completes immediately', async () => {
    let ran = false;
    await runWithConcurrency(
      [],
      2,
      async () => {
        ran = true;
        return 'done' as const;
      },
      { onOutcome: () => {}, shouldAbort: () => false },
    );
    expect(ran).toBe(false);
  });

  it('depth larger than item count launches all items, never more', async () => {
    const items = [0, 1];
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrency(
      items,
      10,
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return 'done' as const;
      },
      { onOutcome: () => {}, shouldAbort: () => false },
    );
    expect(maxInFlight).toBe(2);
  });
});
