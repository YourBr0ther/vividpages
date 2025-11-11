import { Queue } from 'bullmq';
import { connection } from './connection.js';

// ============================================
// Queue Definitions
// ============================================

/**
 * EPUB Processing Queue
 * Handles parsing EPUB files and extracting scenes
 */
export const epubQueue = new Queue('epub-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5 second delay
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

/**
 * Scene Analysis Queue
 * Handles LLM analysis of individual scenes
 */
export const sceneAnalysisQueue = new Queue('scene-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 2, // Fewer retries for LLM calls (expensive)
    backoff: {
      type: 'exponential',
      delay: 10000, // Start with 10 second delay
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 50,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

/**
 * LLM Analysis Queue (legacy - keeping for compatibility)
 * Handles character extraction and scene analysis with LLMs
 */
export const llmQueue = sceneAnalysisQueue;

/**
 * Image Generation Queue
 * Handles storyboard image generation
 */
export const imageQueue = new Queue('image-generation', {
  connection,
  defaultJobOptions: {
    attempts: 2, // Fewer retries for image gen (expensive)
    backoff: {
      type: 'exponential',
      delay: 15000, // Start with 15 second delay
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 50,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

// ============================================
// Queue Event Listeners
// ============================================

epubQueue.on('waiting', (job) => {
  console.log(`📋 EPUB job ${job.id} is waiting`);
});

epubQueue.on('active', (job) => {
  console.log(`⚙️  EPUB job ${job.id} is now active`);
});

epubQueue.on('completed', (job) => {
  console.log(`✅ EPUB job ${job.id} completed`);
});

epubQueue.on('failed', (job, err) => {
  console.error(`❌ EPUB job ${job?.id} failed:`, err.message);
});

llmQueue.on('waiting', (job) => {
  console.log(`📋 LLM job ${job.id} is waiting`);
});

llmQueue.on('active', (job) => {
  console.log(`⚙️  LLM job ${job.id} is now active`);
});

llmQueue.on('completed', (job) => {
  console.log(`✅ LLM job ${job.id} completed`);
});

llmQueue.on('failed', (job, err) => {
  console.error(`❌ LLM job ${job?.id} failed:`, err.message);
});

imageQueue.on('waiting', (job) => {
  console.log(`📋 Image job ${job.id} is waiting`);
});

imageQueue.on('active', (job) => {
  console.log(`⚙️  Image job ${job.id} is now active`);
});

imageQueue.on('completed', (job) => {
  console.log(`✅ Image job ${job.id} completed`);
});

imageQueue.on('failed', (job, err) => {
  console.error(`❌ Image job ${job?.id} failed:`, err.message);
});

// ============================================
// Queue Operations
// ============================================

/**
 * Add EPUB parsing job to queue
 */
export async function queueEpubParsing(vividPageId: string, userId: string) {
  const job = await epubQueue.add(
    'parse-epub',
    {
      vividPageId,
      userId,
      timestamp: Date.now(),
    },
    {
      jobId: `epub-${vividPageId}`, // Use vividPageId as unique job ID
    }
  );

  console.log(`📤 Queued EPUB parsing job: ${job.id}`);
  return job;
}

/**
 * Add scene analysis job to queue
 */
export async function queueSceneAnalysis(vividPageId: string, userId: string, limit?: number) {
  const job = await sceneAnalysisQueue.add(
    'analyze-scenes',
    {
      vividPageId,
      userId,
      limit, // Optional: limit number of scenes to analyze
      timestamp: Date.now(),
    },
    {
      jobId: `analysis-${vividPageId}`,
    }
  );

  console.log(`📤 Queued scene analysis job: ${job.id}${limit ? ` (limit: ${limit} scenes)` : ''}`);
  return job;
}

/**
 * Add LLM analysis job to queue (legacy - use queueSceneAnalysis instead)
 */
export async function queueLlmAnalysis(vividPageId: string, userId: string, settings?: any) {
  return queueSceneAnalysis(vividPageId, userId);
}

/**
 * Add image generation job to queue
 */
export async function queueImageGeneration(vividPageId: string, userId: string, settings: any) {
  const job = await imageQueue.add(
    'generate-images',
    {
      vividPageId,
      userId,
      settings,
      timestamp: Date.now(),
    },
    {
      jobId: `image-${vividPageId}`,
    }
  );

  console.log(`📤 Queued image generation job: ${job.id}`);
  return job;
}

/**
 * Get job status
 */
export async function getJobStatus(queueName: string, jobId: string) {
  let queue: Queue;

  switch (queueName) {
    case 'epub-processing':
      queue = epubQueue;
      break;
    case 'scene-analysis':
      queue = sceneAnalysisQueue;
      break;
    case 'llm-analysis':
      queue = llmQueue;
      break;
    case 'image-generation':
      queue = imageQueue;
      break;
    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }

  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    id: job.id,
    state,
    progress,
    data: job.data,
    returnValue: job.returnvalue,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  };
}

/**
 * Clean up old jobs
 */
export async function cleanupOldJobs() {
  console.log('🧹 Cleaning up old jobs...');

  await epubQueue.clean(24 * 3600 * 1000, 100, 'completed'); // 24 hours
  await epubQueue.clean(7 * 24 * 3600 * 1000, 0, 'failed'); // 7 days

  await sceneAnalysisQueue.clean(24 * 3600 * 1000, 50, 'completed');
  await sceneAnalysisQueue.clean(7 * 24 * 3600 * 1000, 0, 'failed');

  await imageQueue.clean(24 * 3600 * 1000, 50, 'completed');
  await imageQueue.clean(7 * 24 * 3600 * 1000, 0, 'failed');

  console.log('✅ Cleanup complete');
}

// ============================================
// Graceful Shutdown
// ============================================

export async function closeQueues() {
  console.log('🔌 Closing job queues...');

  await epubQueue.close();
  await sceneAnalysisQueue.close();
  await imageQueue.close();
  await connection.quit();

  console.log('✅ Queues closed');
}

process.on('SIGTERM', closeQueues);
process.on('SIGINT', closeQueues);
