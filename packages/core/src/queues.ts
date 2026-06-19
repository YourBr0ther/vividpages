import { Queue, Worker, type Job, type Processor, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';

import { getEnv } from './env';

/** The five pipeline queues, in stage order. */
export const QUEUE = {
  ingest: 'ingest',
  segment: 'segment',
  analyze: 'analyze',
  profiles: 'profiles',
  imagine: 'imagine',
} as const;

export type QueueName = keyof typeof QUEUE;

/** Payload for the linear pipeline stages. */
export interface StageJobPayload {
  bookId: string;
  runId: string;
}

/** Profiles can be forced to recompute already-profiled characters. */
export interface ProfilesJobPayload extends StageJobPayload {
  /** Re-run LLM profiling even for characters that already have a profile. */
  force?: boolean;
  /**
   * True when profiles was reached as part of the full auto-chained pipeline
   * (upload wizard → ingest → … → profiles): on success it continues into
   * imagine. The standalone "Rebuild profiles" re-run leaves this unset, so a
   * manual profiles rebuild stops at profiles (no surprise art regeneration).
   */
  autoChain?: boolean;
}

/** Regenerate exactly one subject (portrait or storyboard point). */
export interface ImagineOnlyOne {
  kind: 'character_portrait' | 'scene_storyboard';
  subjectId: string;
  version?: number;
}

/**
 * Regenerate a SET of storyboard points in one job — used by the character
 * merge to re-illustrate every affected scene at once. Each point gets its own
 * next version (max+1). Only valid for storyboards.
 */
export interface ImagineOnlyStoryboardSet {
  kind: 'scene_storyboard';
  subjectIds: string[];
}

/**
 * Imagine can optionally target specific subjects for regeneration (skipping
 * Phase 0 planning): a single subject, or a set of storyboard points.
 */
export type ImagineOnly = ImagineOnlyOne | ImagineOnlyStoryboardSet;

export interface ImagineJobPayload extends StageJobPayload {
  only?: ImagineOnly;
}

/** True when an `only` payload targets a SET of storyboard points. */
export function isOnlySet(only: ImagineOnly): only is ImagineOnlyStoryboardSet {
  return 'subjectIds' in only;
}

export interface QueuePayloads {
  ingest: StageJobPayload;
  segment: StageJobPayload;
  analyze: StageJobPayload;
  profiles: ProfilesJobPayload;
  imagine: ImagineJobPayload;
}

let connection: Redis | undefined;

function getConnection(): Redis {
  if (!connection) {
    // BullMQ requires maxRetriesPerRequest: null; it duplicates this
    // connection internally for blocking commands where needed.
    connection = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

const queues = new Map<QueueName, Queue>();

/** Lazy per-name Queue singletons with shared retry/retention defaults. */
export function getQueue<N extends QueueName>(name: N): Queue<QueuePayloads[N]> {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(QUEUE[name], {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    queues.set(name, queue);
  }
  return queue as Queue<QueuePayloads[N]>;
}

/**
 * Creates a BullMQ Worker for a queue. The caller owns the returned Worker
 * and must close() it on shutdown (closeQueues() only closes queues and the
 * shared connection).
 */
export function makeWorker<N extends QueueName>(
  name: N,
  processor: Processor<QueuePayloads[N], unknown>,
  opts: { concurrency?: number } & Partial<WorkerOptions> = {},
): Worker<QueuePayloads[N], unknown> {
  const { concurrency = 1, ...rest } = opts;
  return new Worker<QueuePayloads[N], unknown>(QUEUE[name], processor, {
    connection: getConnection(),
    concurrency,
    ...rest,
  });
}

export type { Job, Processor, Queue, Worker };

/** Closes all queue singletons and the shared Redis connection. */
export async function closeQueues(): Promise<void> {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(open.map((queue) => queue.close()));
  if (connection) {
    const conn = connection;
    connection = undefined;
    await conn.quit();
  }
}
