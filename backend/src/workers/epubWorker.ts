import { Worker, Job } from 'bullmq';
import { connection } from '../queue/connection.js';
import { db } from '../db/index.js';
import { vividPages, scenes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { downloadFile, uploadBuffer } from '../lib/minio.js';
import { parseEpub, getTotalWordCount } from '../lib/epubParser.js';
import { detectScenes } from '../lib/sceneDetector.js';
import path from 'path';
import fs from 'fs';

// ============================================
// Job Data Interface
// ============================================

interface EpubJobData {
  vividPageId: string;
  userId: string;
  timestamp: number;
}

// ============================================
// EPUB Worker
// ============================================

export const epubWorker = new Worker<EpubJobData>(
  'epub-processing',
  async (job: Job<EpubJobData>) => {
    const { vividPageId, userId } = job.data;

    console.log(`\n📚 Processing EPUB for VividPage: ${vividPageId}`);

    try {
      // ============================================
      // Step 1: Get VividPage from database
      // ============================================
      job.updateProgress(5);
      await updateVividPageProgress(vividPageId, 5, 'Loading EPUB information...');

      const vividPage = await db.query.vividPages.findFirst({
        where: eq(vividPages.id, vividPageId),
      });

      if (!vividPage) {
        throw new Error(`VividPage not found: ${vividPageId}`);
      }

      console.log(`✅ Found VividPage: ${vividPage.title}`);

      // ============================================
      // Step 2: Download EPUB from MinIO
      // ============================================
      job.updateProgress(10);
      await updateVividPageProgress(vividPageId, 10, 'Downloading EPUB file...');

      const tempDir = '/tmp/epub-processing';
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, `${vividPageId}.epub`);
      await downloadFile(vividPage.epubPath, tempFilePath);

      console.log(`✅ Downloaded EPUB to: ${tempFilePath}`);

      // ============================================
      // Step 3: Parse EPUB
      // ============================================
      job.updateProgress(25);
      await updateVividPageProgress(vividPageId, 25, 'Parsing EPUB file...');

      const { metadata, chapters } = await parseEpub(tempFilePath);

      console.log(`✅ Parsed EPUB:`);
      console.log(`   - Title: ${metadata.title}`);
      console.log(`   - Author: ${metadata.author}`);
      console.log(`   - Chapters: ${chapters.length}`);
      console.log(`   - Total words: ${getTotalWordCount(chapters)}`);

      // ============================================
      // Step 4: Upload cover image if present
      // ============================================
      let coverImagePath: string | null = null;

      if (metadata.cover) {
        job.updateProgress(40);
        await updateVividPageProgress(vividPageId, 40, 'Processing cover image...');

        try {
          const coverPath = `covers/${userId}/${vividPageId}.jpg`;
          await uploadBuffer(coverPath, metadata.cover, metadata.cover.length, {
            'Content-Type': 'image/jpeg',
          });
          coverImagePath = coverPath;
          console.log(`✅ Uploaded cover image: ${coverPath}`);
        } catch (error) {
          console.error('❌ Failed to upload cover:', error);
        }
      }

      // ============================================
      // Step 5: Detect scenes
      // ============================================
      job.updateProgress(50);
      await updateVividPageProgress(vividPageId, 50, 'Detecting scenes...');

      const detectedScenes = detectScenes(chapters);

      console.log(`✅ Detected ${detectedScenes.length} scenes`);

      // ============================================
      // Step 6: Save scenes to database
      // ============================================
      job.updateProgress(70);
      await updateVividPageProgress(vividPageId, 70, 'Saving scenes to database...');

      // Insert scenes in batches for better performance
      const batchSize = 100;
      for (let i = 0; i < detectedScenes.length; i += batchSize) {
        const batch = detectedScenes.slice(i, i + batchSize);

        await db.insert(scenes).values(
          batch.map(scene => ({
            vividPageId,
            chapterNumber: scene.chapterNumber,
            chapterTitle: scene.chapterTitle,
            sceneNumber: scene.sceneNumber,
            sceneIndexGlobal: scene.sceneIndexGlobal,
            textContent: scene.textContent,
            wordCount: scene.wordCount,
            sceneType: scene.sceneType,
            hasDialogue: scene.hasDialogue,
            characterCount: scene.characterCount,
          }))
        );

        const progress = 70 + Math.floor((i / detectedScenes.length) * 20);
        job.updateProgress(progress);
        await updateVividPageProgress(
          vividPageId,
          progress,
          `Saving scenes... (${i + batch.length}/${detectedScenes.length})`
        );
      }

      console.log(`✅ Saved ${detectedScenes.length} scenes to database`);

      // ============================================
      // Step 7: Update VividPage with final data
      // ============================================
      job.updateProgress(95);
      await updateVividPageProgress(vividPageId, 95, 'Finalizing...');

      await db.update(vividPages)
        .set({
          title: metadata.title,
          author: metadata.author,
          isbn: metadata.isbn,
          language: metadata.language,
          coverImagePath,
          totalChapters: chapters.length,
          totalScenes: detectedScenes.length,
          wordCount: getTotalWordCount(chapters),
          status: 'scenes_detected',
          progressPercent: 100,
          currentStep: 'EPUB processing complete',
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      console.log(`✅ Updated VividPage with final data`);

      // ============================================
      // Step 8: Cleanup
      // ============================================
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`🗑️  Cleaned up temporary file`);
      }

      job.updateProgress(100);

      console.log(`\n✅ Successfully processed EPUB for VividPage: ${vividPageId}\n`);

      return {
        success: true,
        vividPageId,
        chaptersProcessed: chapters.length,
        scenesDetected: detectedScenes.length,
        wordCount: getTotalWordCount(chapters),
      };

    } catch (error) {
      console.error(`\n❌ Error processing EPUB for VividPage ${vividPageId}:`, error);

      // Update VividPage with error status
      await db.update(vividPages)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(vividPages.id, vividPageId));

      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.EPUB_WORKERS || '2'), // Process 2 EPUBs concurrently
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
  await db.update(vividPages)
    .set({
      progressPercent,
      currentStep,
      updatedAt: new Date(),
    })
    .where(eq(vividPages.id, vividPageId));
}

// ============================================
// Worker Event Listeners
// ============================================

epubWorker.on('completed', (job) => {
  console.log(`✅ EPUB Worker completed job: ${job.id}`);
});

epubWorker.on('failed', (job, err) => {
  console.error(`❌ EPUB Worker failed job ${job?.id}:`, err.message);
});

epubWorker.on('error', (err) => {
  console.error('❌ EPUB Worker error:', err);
});

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown() {
  console.log('\n🛑 Shutting down EPUB worker...');
  await epubWorker.close();
  await connection.quit();
  console.log('✅ EPUB worker shut down');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('🚀 EPUB Worker started and ready to process jobs');
