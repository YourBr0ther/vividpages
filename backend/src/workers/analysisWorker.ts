import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection.js';
import { db } from '../db/index.js';
import { vividPages, scenes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { ollama } from '../lib/ollama.js';
import { emitProgress, emitStatusUpdate, emitErrorUpdate, emitCompletion } from '../lib/progressEmitter.js';

// ============================================
// Job Data Interface
// ============================================

interface AnalysisJobData {
  vividPageId: string;
  userId: string;
  timestamp: number;
}

// ============================================
// Analysis Worker
// ============================================

export const analysisWorker = new Worker<AnalysisJobData>(
  'scene-analysis',
  async (job: Job<AnalysisJobData>) => {
    const { vividPageId, userId } = job.data;

    console.log(`\n🤖 Analyzing scenes for VividPage: ${vividPageId}`);

    try {
      // ============================================
      // Step 1: Check Ollama health
      // ============================================
      job.updateProgress(5);
      await updateVividPageProgress(vividPageId, 5, 'Connecting to LLM...');

      const isHealthy = await ollama.checkHealth();
      if (!isHealthy) {
        throw new Error('Ollama service is not available. Please ensure Ollama is running.');
      }

      console.log(`✅ Ollama is healthy`);

      // ============================================
      // Step 2: Get VividPage and scenes
      // ============================================
      job.updateProgress(10);
      await updateVividPageProgress(vividPageId, 10, 'Loading scenes...');

      const vividPage = await db.query.vividPages.findFirst({
        where: eq(vividPages.id, vividPageId),
      });

      if (!vividPage) {
        throw new Error(`VividPage not found: ${vividPageId}`);
      }

      // Get all scenes that need analysis
      const allScenes = await db.query.scenes.findMany({
        where: and(
          eq(scenes.vividPageId, vividPageId),
          eq(scenes.analysisStatus, 'pending')
        ),
        orderBy: [scenes.sceneIndexGlobal],
      });

      if (allScenes.length === 0) {
        console.log(`⚠️  No scenes to analyze for VividPage: ${vividPageId}`);
        return {
          success: true,
          vividPageId,
          scenesAnalyzed: 0,
          message: 'No scenes pending analysis',
        };
      }

      console.log(`📊 Found ${allScenes.length} scenes to analyze`);

      // ============================================
      // Step 3: Update VividPage status
      // ============================================
      await db.update(vividPages)
        .set({
          status: 'analyzing',
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      emitStatusUpdate(vividPageId, 'analyzing', {
        totalScenes: allScenes.length,
      });

      // ============================================
      // Step 4: Analyze scenes
      // ============================================
      let analyzedCount = 0;
      const errors: Array<{ sceneId: string; error: string }> = [];

      for (let i = 0; i < allScenes.length; i++) {
        const scene = allScenes[i];

        // Calculate progress (10% to 90%)
        const progress = 10 + Math.floor((i / allScenes.length) * 80);
        job.updateProgress(progress);
        await updateVividPageProgress(
          vividPageId,
          progress,
          `Analyzing scene ${i + 1}/${allScenes.length}...`
        );

        console.log(`🔍 Analyzing scene ${i + 1}/${allScenes.length} (${scene.id.substring(0, 8)}...)`);

        try {
          // Mark as processing
          await db.update(scenes)
            .set({
              analysisStatus: 'processing',
            })
            .where(eq(scenes.id, scene.id));

          // Analyze the scene
          const analysis = await ollama.analyzeScene(scene.textContent, scene.chapterTitle || undefined);

          // Generate image prompt
          const imagePrompt = ollama.generateImagePrompt(analysis);

          // Save analysis results
          await db.update(scenes)
            .set({
              llmAnalysis: analysis as any,
              imagePrompt,
              analysisStatus: 'completed',
              analyzedAt: new Date(),
              analysisError: null,
            })
            .where(eq(scenes.id, scene.id));

          analyzedCount++;
          console.log(`✅ Scene analyzed: ${scene.id.substring(0, 8)}...`);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Failed to analyze scene ${scene.id}:`, errorMessage);

          // Mark scene as failed
          await db.update(scenes)
            .set({
              analysisStatus: 'failed',
              analysisError: errorMessage,
            })
            .where(eq(scenes.id, scene.id));

          errors.push({
            sceneId: scene.id,
            error: errorMessage,
          });
        }

        // Add small delay between requests to avoid overwhelming Ollama
        if (i < allScenes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // ============================================
      // Step 5: Update VividPage with final status
      // ============================================
      job.updateProgress(95);
      await updateVividPageProgress(vividPageId, 95, 'Finalizing...');

      const hasErrors = errors.length > 0;
      const finalStatus = hasErrors ? 'scenes_detected' : 'analyzed';

      await db.update(vividPages)
        .set({
          status: finalStatus,
          progressPercent: 100,
          currentStep: hasErrors
            ? `Analysis complete with ${errors.length} error(s)`
            : 'Scene analysis complete',
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      console.log(`✅ Analysis complete: ${analyzedCount}/${allScenes.length} scenes analyzed`);

      if (hasErrors) {
        console.log(`⚠️  ${errors.length} scene(s) failed analysis`);
      }

      // Emit completion event
      emitCompletion(vividPageId, {
        scenesAnalyzed: analyzedCount,
        totalScenes: allScenes.length,
        errors: errors.length,
      });

      emitStatusUpdate(vividPageId, finalStatus, {
        scenesAnalyzed: analyzedCount,
        totalScenes: allScenes.length,
      });

      job.updateProgress(100);

      console.log(`\n✅ Successfully analyzed scenes for VividPage: ${vividPageId}\n`);

      return {
        success: true,
        vividPageId,
        scenesAnalyzed: analyzedCount,
        totalScenes: allScenes.length,
        errors: errors.length,
      };

    } catch (error) {
      console.error(`\n❌ Error analyzing scenes for VividPage ${vividPageId}:`, error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update VividPage with error status
      await db.update(vividPages)
        .set({
          status: 'scenes_detected', // Keep at scenes_detected so user can retry
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      // Emit error event
      emitErrorUpdate(vividPageId, errorMessage);
      emitStatusUpdate(vividPageId, 'scenes_detected', { errorMessage });

      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.LLM_WORKERS || '1'), // Process 1 analysis at a time by default
  }
);

// ============================================
// Helper Functions
// ============================================

async function updateVividPageProgress(
  vividPageId: string,
  progressPercent: number,
  currentStep: string
): Promise<void> {
  // Update database
  await db.update(vividPages)
    .set({
      progressPercent,
      currentStep,
      updatedAt: new Date(),
    })
    .where(eq(vividPages.id, vividPageId));

  // Emit real-time progress via Redis pub/sub -> Socket.IO
  emitProgress(vividPageId, progressPercent, currentStep);
}

// ============================================
// Worker Event Listeners
// ============================================

analysisWorker.on('completed', (job) => {
  console.log(`✅ Analysis Worker completed job: ${job.id}`);
});

analysisWorker.on('failed', (job, err) => {
  console.error(`❌ Analysis Worker failed job ${job?.id}:`, err.message);
});

analysisWorker.on('error', (err) => {
  console.error('❌ Analysis Worker error:', err);
});

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown() {
  console.log('\n🛑 Shutting down Analysis worker...');
  await analysisWorker.close();
  await connection.quit();
  console.log('✅ Analysis worker shut down');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('🚀 Analysis Worker started and ready to process jobs');
