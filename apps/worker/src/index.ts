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
  type Worker,
} from '@vividpages/core';
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

// Stub processors for now — later tasks replace these with the real pipeline
// stages. console.log is fine at this stage; structured logging can come
// later.
const workers: Worker[] = (Object.keys(QUEUE) as QueueName[]).map((name) => {
  const worker = makeWorker(
    name,
    async (job) => {
      console.log(`[${name}] processing job ${job.id}:`, JSON.stringify(job.data));
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
