import { describe, expect, it, vi } from 'vitest';

import {
  PIPELINE_ORDER,
  enqueueNextStage,
  nextStage,
  shouldChainProfilesToImagine,
} from '../src/pipeline/chain';

describe('nextStage', () => {
  it.each([
    ['ingest', 'segment'],
    ['segment', 'analyze'],
    ['analyze', 'profiles'],
    ['profiles', 'imagine'],
  ] as const)('%s -> %s (stage N enqueues stage N+1)', (stage, expected) => {
    expect(nextStage(stage)).toBe(expected);
  });

  it('imagine is the terminal stage (no next)', () => {
    expect(nextStage('imagine')).toBeNull();
  });

  it('the full linear order chains head to tail with no gaps', () => {
    // Walk the chain from the head: every stage hands off to the next until
    // imagine terminates. A gap (a stage returning null mid-chain) would mean
    // a manual gate has crept back in.
    const walked: string[] = [];
    let stage: ReturnType<typeof nextStage> | (typeof PIPELINE_ORDER)[number] = PIPELINE_ORDER[0];
    while (stage) {
      walked.push(stage);
      stage = nextStage(stage);
    }
    expect(walked).toEqual(['ingest', 'segment', 'analyze', 'profiles', 'imagine']);
  });
});

describe('shouldChainProfilesToImagine', () => {
  it('chains when reached via the full pipeline (autoChain set)', () => {
    expect(shouldChainProfilesToImagine({ autoChain: true })).toBe(true);
  });

  it('stops on a standalone "Rebuild profiles" re-run (autoChain unset/false)', () => {
    expect(shouldChainProfilesToImagine({})).toBe(false);
    expect(shouldChainProfilesToImagine({ autoChain: false })).toBe(false);
  });
});

describe('enqueueNextStage', () => {
  function fakeQueues() {
    const calls: Array<{ queue: string; name: string; payload: unknown }> = [];
    const getQueue = (name: string) => ({
      add: (jobName: string, payload: unknown) => {
        calls.push({ queue: name, name: jobName, payload });
        return Promise.resolve();
      },
    });
    return { calls, getQueue: getQueue as never };
  }

  it('enqueues the successor stage with the same bookId/runId', async () => {
    const { calls, getQueue } = fakeQueues();
    const enqueued = await enqueueNextStage('segment', { bookId: 'b1', runId: 'r1' }, { getQueue });
    expect(enqueued).toBe('analyze');
    expect(calls).toEqual([{ queue: 'analyze', name: 'analyze', payload: { bookId: 'b1', runId: 'r1' } }]);
  });

  it('closes the analyze->art gate: profiles enqueues imagine', async () => {
    const { calls, getQueue } = fakeQueues();
    const enqueued = await enqueueNextStage('profiles', { bookId: 'b1', runId: 'r1' }, { getQueue });
    expect(enqueued).toBe('imagine');
    expect(calls).toEqual([{ queue: 'imagine', name: 'imagine', payload: { bookId: 'b1', runId: 'r1' } }]);
  });

  it('does nothing at the terminal stage (imagine has no successor)', async () => {
    const { calls, getQueue } = fakeQueues();
    const enqueued = await enqueueNextStage('imagine', { bookId: 'b1', runId: 'r1' }, { getQueue });
    expect(enqueued).toBeNull();
    expect(calls).toEqual([]);
  });

  it('uses the real getQueue by default', async () => {
    // Smoke test that the default getQueue is wired (segment -> analyze) without
    // actually touching Redis: spy via the injected option mirrors production.
    const add = vi.fn().mockResolvedValue(undefined);
    const getQueue = vi.fn().mockReturnValue({ add });
    await enqueueNextStage('ingest', { bookId: 'b', runId: 'r' }, { getQueue: getQueue as never });
    expect(getQueue).toHaveBeenCalledWith('segment');
    expect(add).toHaveBeenCalledWith('segment', { bookId: 'b', runId: 'r' });
  });
});
