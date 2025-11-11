import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { upload, cleanupTempFile } from '../../lib/upload.js';
import { uploadFile, ensureBucket } from '../../lib/minio.js';
import { queueEpubParsing } from '../../queue/queues.js';
import { calculateFileHash } from '../../lib/fileHash.js';
import { db } from '../../db/index.js';
import { vividPages, scenes } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import path from 'path';

const router = express.Router();

// Initialize MinIO bucket on startup
ensureBucket().catch(console.error);

/**
 * Upload EPUB file
 * POST /api/vividpages/upload
 */
router.post('/upload', authMiddleware, upload.single('epub'), async (req: Request, res: Response) => {
  const file = req.file;
  const user = req.user!;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    console.log(`📤 Uploading EPUB: ${file.originalname} (${file.size} bytes)`);

    // Calculate file hash for duplicate detection
    console.log(`🔐 Calculating file hash...`);
    const fileHash = await calculateFileHash(file.path);
    console.log(`✅ File hash: ${fileHash}`);

    // Check for duplicate
    const existingVividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.userId, user.id),
        eq(vividPages.epubHash, fileHash)
      ),
    });

    if (existingVividPage) {
      // Clean up temp file
      cleanupTempFile(file.path);

      return res.status(409).json({
        error: 'Duplicate file',
        message: 'You have already uploaded this EPUB',
        existingVividPage: {
          id: existingVividPage.id,
          title: existingVividPage.title,
          author: existingVividPage.author,
          status: existingVividPage.status,
          createdAt: existingVividPage.createdAt,
        },
      });
    }

    // Generate unique path in MinIO
    const userId = user.id;
    const timestamp = Date.now();
    const minioPath = `epubs/${userId}/${timestamp}-${file.originalname}`;

    // Upload to MinIO
    await uploadFile(minioPath, file.path, {
      'Content-Type': 'application/epub+zip',
      'Original-Filename': file.originalname,
    });

    // Create VividPage record
    const [vividPage] = await db.insert(vividPages).values({
      userId,
      title: path.basename(file.originalname, '.epub'), // Temporary title, will be updated after parsing
      author: null,
      epubFilename: file.originalname,
      epubPath: minioPath,
      epubSizeBytes: file.size,
      epubHash: fileHash,
      status: 'uploading',
      progressPercent: 10,
      currentStep: 'File uploaded, queuing for processing...',
    }).returning();

    console.log(`✅ Created VividPage: ${vividPage.id}`);

    // Clean up temporary file
    cleanupTempFile(file.path);

    // Queue EPUB parsing job
    const job = await queueEpubParsing(vividPage.id, userId);

    // Update status to queued
    await db.update(vividPages)
      .set({
        status: 'parsing',
        progressPercent: 15,
        currentStep: 'Queued for processing',
        updatedAt: new Date(),
      })
      .where(eq(vividPages.id, vividPage.id));

    console.log(`✅ Queued EPUB parsing job ${job.id} for VividPage ${vividPage.id}`);

    res.status(201).json({
      success: true,
      vividPage: {
        id: vividPage.id,
        title: vividPage.title,
        filename: vividPage.epubFilename,
        status: 'parsing',
        progressPercent: 15,
      },
    });

  } catch (error) {
    console.error('❌ Error uploading EPUB:', error);

    // Clean up temporary file
    if (file) {
      cleanupTempFile(file.path);
    }

    res.status(500).json({
      error: 'Failed to upload EPUB',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get user's VividPages
 * GET /api/vividpages
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const userVividPages = await db.query.vividPages.findMany({
      where: eq(vividPages.userId, user.id),
      orderBy: [desc(vividPages.createdAt)],
    });

    res.json(userVividPages);
  } catch (error) {
    console.error('❌ Error fetching VividPages:', error);
    res.status(500).json({
      error: 'Failed to fetch VividPages',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get single VividPage by ID
 * GET /api/vividpages/:id
 */
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    res.json(vividPage);
  } catch (error) {
    console.error('❌ Error fetching VividPage:', error);
    res.status(500).json({
      error: 'Failed to fetch VividPage',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get VividPage status (for polling)
 * GET /api/vividpages/:id/status
 */
router.get('/:id/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
      columns: {
        status: true,
        progressPercent: true,
        currentStep: true,
        errorMessage: true,
        totalChapters: true,
        totalScenes: true,
      },
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    res.json(vividPage);
  } catch (error) {
    console.error('❌ Error fetching VividPage status:', error);
    res.status(500).json({
      error: 'Failed to fetch status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get scenes for a VividPage
 * GET /api/vividpages/:id/scenes
 */
router.get('/:id/scenes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    // Verify ownership
    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    // Get scenes
    const vividPageScenes = await db.query.scenes.findMany({
      where: eq(scenes.vividPageId, id),
      orderBy: [scenes.sceneIndexGlobal],
    });

    res.json(vividPageScenes);
  } catch (error) {
    console.error('❌ Error fetching scenes:', error);
    res.status(500).json({
      error: 'Failed to fetch scenes',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Retry processing a failed VividPage
 * POST /api/vividpages/:id/retry
 */
router.post('/:id/retry', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    // Verify ownership
    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    // Only allow retry for failed status
    if (vividPage.status !== 'failed') {
      return res.status(400).json({
        error: 'Cannot retry',
        message: `VividPage status is "${vividPage.status}". Only failed VividPages can be retried.`,
      });
    }

    console.log(`🔄 Retrying VividPage: ${id}`);

    // Remove old job if it exists
    const { epubQueue } = await import('../../queue/queues.js');
    const oldJobId = `epub-${id}`;
    const oldJob = await epubQueue.getJob(oldJobId);
    if (oldJob) {
      console.log(`🗑️  Removing old job: ${oldJobId}`);
      await oldJob.remove();
    }

    // Reset status and progress
    await db.update(vividPages)
      .set({
        status: 'parsing',
        progressPercent: 15,
        currentStep: 'Retrying processing...',
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(vividPages.id, id));

    // Re-queue the job
    const job = await queueEpubParsing(id, user.id);

    console.log(`✅ Re-queued EPUB parsing job ${job.id} for VividPage ${id}`);

    res.json({
      success: true,
      message: 'Processing restarted',
      vividPage: {
        id,
        status: 'parsing',
        progressPercent: 15,
      },
    });

  } catch (error) {
    console.error('❌ Error retrying VividPage:', error);
    res.status(500).json({
      error: 'Failed to retry processing',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get VividPage cover image
 * GET /api/vividpages/:id/cover
 * Public endpoint - no auth required (cover images are not sensitive)
 */
router.get('/:id/cover', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get VividPage (no ownership check - covers are public)
    const vividPage = await db.query.vividPages.findFirst({
      where: eq(vividPages.id, id),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    if (!vividPage.coverImagePath) {
      return res.status(404).json({ error: 'Cover image not found' });
    }

    // Stream the cover image from MinIO
    const { getFileStream } = await import('../../lib/minio.js');
    const stream = await getFileStream(vividPage.coverImagePath);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow cross-origin image loading

    stream.pipe(res);
  } catch (error) {
    console.error('❌ Error fetching cover image:', error);
    res.status(500).json({
      error: 'Failed to fetch cover image',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Trigger scene analysis for a VividPage
 * POST /api/vividpages/:id/analyze
 */
router.post('/:id/analyze', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { limit } = req.body; // Optional: limit number of scenes to analyze

    // Verify ownership
    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    // Check if scenes have been detected
    if (vividPage.status !== 'scenes_detected' && vividPage.status !== 'analyzed') {
      return res.status(400).json({
        error: 'Cannot analyze',
        message: `VividPage status is "${vividPage.status}". Scenes must be detected before analysis.`,
      });
    }

    // Check if there are any scenes
    const sceneCount = await db.query.scenes.findMany({
      where: eq(scenes.vividPageId, id),
    });

    if (sceneCount.length === 0) {
      return res.status(400).json({
        error: 'No scenes found',
        message: 'This VividPage has no scenes to analyze.',
      });
    }

    const scenesToAnalyze = limit ? Math.min(limit, sceneCount.length) : sceneCount.length;
    console.log(`🤖 Triggering analysis for VividPage: ${id} (${scenesToAnalyze} scenes)`);

    // Update status to analyzing
    await db.update(vividPages)
      .set({
        status: 'analyzing',
        progressPercent: 10,
        currentStep: `Queueing scene analysis... (${scenesToAnalyze} scenes)`,
        updatedAt: new Date(),
      })
      .where(eq(vividPages.id, id));

    // Queue the analysis job with optional limit
    const { queueSceneAnalysis } = await import('../../queue/queues.js');
    const job = await queueSceneAnalysis(id, user.id, limit);

    console.log(`✅ Queued scene analysis job ${job.id} for VividPage ${id}`);

    res.json({
      success: true,
      message: 'Scene analysis started',
      vividPage: {
        id,
        status: 'analyzing',
        progressPercent: 10,
      },
    });

  } catch (error) {
    console.error('❌ Error triggering scene analysis:', error);
    res.status(500).json({
      error: 'Failed to start scene analysis',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get a single scene with analysis data
 * GET /api/vividpages/:id/scenes/:sceneId
 */
router.get('/:id/scenes/:sceneId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id, sceneId } = req.params;

    // Verify ownership of VividPage
    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    // Get the scene
    const scene = await db.query.scenes.findFirst({
      where: and(
        eq(scenes.id, sceneId),
        eq(scenes.vividPageId, id)
      ),
    });

    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    res.json(scene);
  } catch (error) {
    console.error('❌ Error fetching scene:', error);
    res.status(500).json({
      error: 'Failed to fetch scene',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Delete a VividPage
 * DELETE /api/vividpages/:id
 * Note: EPUB file is kept in MinIO as it may be needed for reading/voice features
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    // Verify ownership
    const vividPage = await db.query.vividPages.findFirst({
      where: and(
        eq(vividPages.id, id),
        eq(vividPages.userId, user.id)
      ),
    });

    if (!vividPage) {
      return res.status(404).json({ error: 'VividPage not found' });
    }

    // Keep EPUB in MinIO (needed for reading and future voice features)
    // Delete from database (cascade will delete jobs and scenes)
    await db.delete(vividPages).where(eq(vividPages.id, id));

    res.json({ success: true, message: 'VividPage deleted' });
  } catch (error) {
    console.error('❌ Error deleting VividPage:', error);
    res.status(500).json({
      error: 'Failed to delete VividPage',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
