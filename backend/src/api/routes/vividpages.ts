import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { upload, cleanupTempFile } from '../../lib/upload.js';
import { uploadFile, ensureBucket } from '../../lib/minio.js';
import { queueEpubParsing } from '../../queue/queues.js';
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
 * Delete a VividPage
 * DELETE /api/vividpages/:id
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

    // TODO: Delete EPUB from MinIO
    // await deleteFile(vividPage.epubPath);

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
