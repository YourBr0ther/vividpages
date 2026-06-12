import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

// Load the repo-root .env into process.env. getEnv() in @vividpages/core is
// a pure process.env reader (no dotenv) because the web app relies on
// Next.js's own env loading — the worker loads its env here, at the
// entrypoint, before calling getEnv().
//
// Note: the static imports below are hoisted above this call, which is safe
// only because @vividpages/core and @vividpages/db read process.env lazily
// (inside getEnv()/getDb()), never at import time. Keep it that way.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

import {
  QUEUE,
  closeQueues,
  closeStorage,
  ensureBuckets,
  getEnv,
  makeWorker,
  type QueueName,
  type StageJobPayload,
  type Worker,
} from '@vividpages/core';
import { runAnalyze } from '@vividpages/core/pipeline/analyze';
import { runIngest } from '@vividpages/core/pipeline/ingest';
import { failRun, setBookStatus } from '@vividpages/core/pipeline/progress';
import { runProfiles } from '@vividpages/core/pipeline/profiles';
import { runSegment } from '@vividpages/core/pipeline/segment';
import { closeDb } from '@vividpages/db';

// Fail fast on a misconfigured environment.
const env = getEnv();

await ensureBuckets();

const concurrency: Record<QueueName, number> = {
  ingest: env.WORKER_CONCURRENCY_INGEST,
  segment: env.WORKER_CONCURRENCY_SEGMENT,
  analyze: env.WORKER_CONCURRENCY_ANALYZE,
  profiles: env.WORKER_CONCURRENCY_PROFILES,
  imagine: env.WORKER_CONCURRENCY_IMAGINE,
};

// Real pipeline stages; imagine remains a stub until M5.
const stageFns: Partial<Record<QueueName, (payload: StageJobPayload) => Promise<void>>> = {
  ingest: runIngest,
  segment: runSegment,
  analyze: runAnalyze,
  profiles: runProfiles,
};

const workers: Worker[] = (Object.keys(QUEUE) as QueueName[]).map((name) => {
  const stageFn = stageFns[name];
  const worker = makeWorker(
    name,
    async (job) => {
      const { bookId, runId } = job.data;
      if (!stageFn) {
        // Stub for not-yet-implemented stages.
        console.log(`[${name}] processing job ${job.id}:`, JSON.stringify(job.data));
        return;
      }
      try {
        // Pass the whole payload through so stage-specific flags (e.g.
        // profiles' `force`) survive the dispatch.
        await stageFn(job.data);
      } catch (err) {
        // Mark the run/book failed on EVERY attempt (not just the last):
        // BullMQ will still retry the job. On retry, the stage function's
        // initial setBookStatus() flips the book back to its running status,
        // and reportProgress() sets the run back to 'running' and clears the
        // error, so a transient 'failed' between attempts is acceptable and
        // keeps this logic simple.
        const message = err instanceof Error ? err.message : String(err);
        try {
          await failRun(runId, message);
          await setBookStatus(bookId, 'failed', message);
        } catch (bookkeepingErr) {
          console.error(`[${name}] failed to record failure for book ${bookId}:`, bookkeepingErr);
        }
        throw err; // rethrow so BullMQ retry/backoff still applies
      }
    },
    { concurrency: concurrency[name] },
  );
  worker.on('completed', (job) => {
    console.log(`[${name}] completed job ${job.id}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[${name}] job ${job?.id ?? '?'} failed:`, err.message);
  });
  worker.on('error', (err) => {
    console.error(`[${name}] worker error:`, err.message);
  });
  return worker;
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down...`);
  try {
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeQueues();
    closeStorage();
    await closeDb();
    console.log('shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(
  `worker ready, queues: ${Object.values(QUEUE).join(', ')} ` +
    `(concurrency ${(Object.keys(QUEUE) as QueueName[]).map((n) => `${n}=${concurrency[n]}`).join(' ')})`,
);
