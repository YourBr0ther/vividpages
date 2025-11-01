# Phase 2: EPUB Processing - Implementation Plan

**Status:** 🚀 Starting
**Duration:** 4 weeks
**Goal:** Parse EPUB files and extract structured content for storyboard generation

---

## Overview

Phase 2 enables users to upload EPUB files and have them automatically processed into structured scenes ready for LLM analysis. This phase establishes the job queue system that will be reused in later phases.

**Key Features:**
- Upload EPUB files via drag-and-drop interface
- Automatic parsing and metadata extraction
- Scene detection and segmentation
- Job queue system with progress tracking
- Display processed books in user's bookcase

---

## Architecture

```
User Upload → MinIO Storage → Job Queue → Worker → Database → UI Display
```

**Components:**
1. **File Upload API** - Receives EPUB files, validates, stores in MinIO
2. **Job Queue (BullMQ)** - Manages async processing tasks
3. **EPUB Parser Worker** - Extracts content and metadata
4. **Scene Detector** - Identifies narrative breaks and scenes
5. **Database** - Stores VividPages, scenes, and metadata
6. **Bookcase UI** - Displays user's library with status

---

## Database Schema

### 1. VividPages Table

```typescript
CREATE TABLE vividpages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- EPUB Info
  title VARCHAR(500) NOT NULL,
  author VARCHAR(500),
  isbn VARCHAR(20),
  language VARCHAR(10) DEFAULT 'en',
  cover_image_url TEXT,
  epub_path TEXT NOT NULL,
  epub_size_bytes INTEGER,

  -- Processing Status
  status VARCHAR(50) NOT NULL DEFAULT 'uploading',
  -- Status values: uploading, parsing, scenes_detected, llm_analysis, generating_images, completed, failed

  progress_percent INTEGER DEFAULT 0,
  current_step VARCHAR(100),
  error_message TEXT,

  -- Generation Settings
  settings JSONB DEFAULT '{}',
  -- { style: 'fantasy', density: 'high', includeCharacters: true }

  -- Metadata
  total_chapters INTEGER DEFAULT 0,
  total_scenes INTEGER DEFAULT 0,
  total_storyboards INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  INDEX idx_vividpages_user (user_id),
  INDEX idx_vividpages_status (status),
  INDEX idx_vividpages_created (created_at DESC)
);
```

### 2. Scenes Table

```typescript
CREATE TABLE scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vividpage_id UUID NOT NULL REFERENCES vividpages(id) ON DELETE CASCADE,

  -- Scene Position
  chapter_number INTEGER NOT NULL,
  chapter_title VARCHAR(500),
  scene_number INTEGER NOT NULL,
  scene_index_global INTEGER NOT NULL,

  -- Content
  text_content TEXT NOT NULL,
  word_count INTEGER NOT NULL,

  -- Scene Metadata
  scene_type VARCHAR(50) DEFAULT 'narrative',
  -- Types: narrative, dialogue, action, description, transition

  has_dialogue BOOLEAN DEFAULT FALSE,
  character_count INTEGER DEFAULT 0,

  -- LLM Analysis (populated in Phase 3)
  llm_analysis JSONB,
  image_prompt TEXT,

  -- Storyboard (populated in Phase 4)
  storyboard_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_scenes_vividpage (vividpage_id),
  INDEX idx_scenes_chapter (vividpage_id, chapter_number),
  INDEX idx_scenes_global (vividpage_id, scene_index_global)
);
```

### 3. Jobs Table (for tracking)

```typescript
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vividpage_id UUID REFERENCES vividpages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  job_type VARCHAR(50) NOT NULL,
  -- Types: epub_parsing, llm_analysis, image_generation, regeneration

  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  -- Status: queued, processing, completed, failed

  progress_percent INTEGER DEFAULT 0,
  progress_message VARCHAR(500),

  bull_job_id VARCHAR(100),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  error_message TEXT,
  error_stack TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_jobs_vividpage (vividpage_id),
  INDEX idx_jobs_user (user_id),
  INDEX idx_jobs_status (status),
  INDEX idx_jobs_type (job_type)
);
```

---

## Implementation Tasks

### Task 2.1: File Upload System ✅

**Backend:**

```typescript
// backend/src/api/routes/vividpages.ts
router.post('/upload',
  authMiddleware,
  upload.single('epub'),
  async (req, res) => {
    // 1. Validate file
    // 2. Save to MinIO
    // 3. Create VividPage record
    // 4. Queue parsing job
    // 5. Return VividPage ID
  }
);
```

**MinIO Setup:**

```typescript
// backend/src/lib/minio.ts
import { Client } from 'minio';

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT!,
  port: parseInt(process.env.MINIO_PORT!),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});

export async function ensureBucket(bucketName: string) {
  const exists = await minioClient.bucketExists(bucketName);
  if (!exists) {
    await minioClient.makeBucket(bucketName);
  }
}

export async function uploadFile(
  bucketName: string,
  objectName: string,
  filePath: string,
  contentType: string
) {
  return minioClient.fPutObject(bucketName, objectName, filePath, {
    'Content-Type': contentType,
  });
}
```

**Frontend:**

```typescript
// frontend/src/components/UploadEpub.tsx
const UploadEpub: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (file.name.endsWith('.epub')) {
      await uploadEpub(file);
    }
  };

  return (
    <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {/* Drag and drop UI */}
    </div>
  );
};
```

**Checklist:**
- [ ] Install multer for file uploads
- [ ] Install minio client
- [ ] Create upload endpoint with validation
- [ ] Set up MinIO buckets
- [ ] Build drag-and-drop upload component
- [ ] Add file size validation (max 50MB)
- [ ] Add .epub extension validation
- [ ] Return upload progress

---

### Task 2.2: BullMQ Job Queue Setup ✅

**Queue Setup:**

```typescript
// backend/src/queue/queues.ts
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

export const epubQueue = new Queue('epub-processing', { connection });
export const llmQueue = new Queue('llm-analysis', { connection });
export const imageQueue = new Queue('image-generation', { connection });

// Add job to queue
export async function queueEpubParsing(vividpageId: string) {
  return epubQueue.add('parse-epub', { vividpageId }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
}
```

**Checklist:**
- [ ] Install bullmq and ioredis
- [ ] Create queue setup file
- [ ] Create job types and interfaces
- [ ] Set up retry logic
- [ ] Add job prioritization
- [ ] Create queue monitoring utilities

---

### Task 2.3: EPUB Parser Worker ✅

**Worker Implementation:**

```typescript
// backend/src/workers/epubWorker.ts
import { Worker } from 'bullmq';
import EPub from 'epub';

const epubWorker = new Worker('epub-processing', async (job) => {
  const { vividpageId } = job.data;

  try {
    // 1. Update status
    await updateVividPage(vividpageId, {
      status: 'parsing',
      current_step: 'Loading EPUB file',
    });

    // 2. Get EPUB from MinIO
    const epubPath = await downloadFromMinio(vividpageId);

    // 3. Parse EPUB
    job.updateProgress(20);
    const metadata = await parseEpubMetadata(epubPath);

    // 4. Extract chapters
    job.updateProgress(40);
    const chapters = await extractChapters(epubPath);

    // 5. Detect scenes
    job.updateProgress(60);
    const scenes = await detectScenes(chapters);

    // 6. Save to database
    job.updateProgress(80);
    await saveScenes(vividpageId, scenes);

    // 7. Update VividPage
    await updateVividPage(vividpageId, {
      status: 'scenes_detected',
      progress_percent: 100,
      total_chapters: chapters.length,
      total_scenes: scenes.length,
      word_count: calculateWordCount(chapters),
    });

    job.updateProgress(100);
    return { success: true };

  } catch (error) {
    await updateVividPage(vividpageId, {
      status: 'failed',
      error_message: error.message,
    });
    throw error;
  }
}, { connection });
```

**EPUB Parsing:**

```typescript
function parseEpubMetadata(epubPath: string): Promise<Metadata> {
  return new Promise((resolve, reject) => {
    const epub = new EPub(epubPath);

    epub.on('end', () => {
      resolve({
        title: epub.metadata.title,
        author: epub.metadata.creator,
        language: epub.metadata.language,
        isbn: epub.metadata.ISBN,
        cover: epub.metadata.cover,
      });
    });

    epub.on('error', reject);
    epub.parse();
  });
}

async function extractChapters(epubPath: string): Promise<Chapter[]> {
  // Extract all chapters with HTML content
  // Convert HTML to plain text
  // Return array of chapters with text
}
```

**Checklist:**
- [ ] Install epub library
- [ ] Create EPUB parser utilities
- [ ] Implement metadata extraction
- [ ] Extract chapter content
- [ ] Convert HTML to plain text
- [ ] Handle malformed EPUBs gracefully
- [ ] Add progress tracking
- [ ] Test with various EPUB formats

---

### Task 2.4: Scene Detection Logic ✅

**Scene Detector:**

```typescript
// backend/src/lib/sceneDetector.ts
export interface Scene {
  chapterNumber: number;
  chapterTitle: string;
  sceneNumber: number;
  textContent: string;
  wordCount: number;
  hasDialogue: boolean;
  sceneType: 'narrative' | 'dialogue' | 'action';
}

export function detectScenes(chapters: Chapter[]): Scene[] {
  const scenes: Scene[] = [];
  let globalSceneIndex = 0;

  for (const chapter of chapters) {
    const chapterScenes = splitIntoScenes(chapter.text);

    chapterScenes.forEach((sceneText, index) => {
      scenes.push({
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        sceneNumber: index + 1,
        textContent: sceneText,
        wordCount: countWords(sceneText),
        hasDialogue: detectDialogue(sceneText),
        sceneType: classifyScene(sceneText),
      });

      globalSceneIndex++;
    });
  }

  return scenes;
}

function splitIntoScenes(text: string): string[] {
  // Scene break heuristics:
  // 1. Multiple blank lines (paragraph breaks)
  // 2. "* * *" or similar separators
  // 3. Time/location changes (detect with regex)
  // 4. POV changes

  const scenes: string[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentScene: string[] = [];

  for (const para of paragraphs) {
    if (isSceneBreak(para)) {
      if (currentScene.length > 0) {
        scenes.push(currentScene.join('\n\n'));
        currentScene = [];
      }
    } else {
      currentScene.push(para);
    }
  }

  if (currentScene.length > 0) {
    scenes.push(currentScene.join('\n\n'));
  }

  return scenes;
}

function isSceneBreak(text: string): boolean {
  // Check for:
  // - "* * *"
  // - "***"
  // - "---"
  // - Time markers: "Three hours later..."
  // - Location markers: "Meanwhile, at..."

  const breakPatterns = [
    /^\s*\*\s*\*\s*\*\s*$/,
    /^\s*-{3,}\s*$/,
    /^\s*_{3,}\s*$/,
    /^(Meanwhile|Later|The next day|Hours later)/i,
  ];

  return breakPatterns.some(pattern => pattern.test(text));
}

function detectDialogue(text: string): boolean {
  // Check for quotation marks
  return /".*?"/g.test(text) || /'.*?'/g.test(text);
}

function classifyScene(text: string): Scene['sceneType'] {
  const dialogueRatio = (text.match(/"/g) || []).length / text.length;

  if (dialogueRatio > 0.3) return 'dialogue';
  if (text.match(/\b(ran|jumped|fought|attacked)\b/gi)) return 'action';
  return 'narrative';
}
```

**Checklist:**
- [ ] Implement scene break detection
- [ ] Detect dialogue vs narrative
- [ ] Classify scene types
- [ ] Handle edge cases (very long/short scenes)
- [ ] Test with different book genres
- [ ] Optimize for performance

---

### Task 2.5: Job Status Tracking ✅

**API Endpoints:**

```typescript
// GET /api/vividpages/:id - Get VividPage with status
router.get('/:id', authMiddleware, async (req, res) => {
  const vividpage = await db.query.vividpages.findFirst({
    where: and(
      eq(vividpages.id, req.params.id),
      eq(vividpages.userId, req.user!.id)
    ),
  });

  if (!vividpage) {
    return res.status(404).json({ error: 'VividPage not found' });
  }

  res.json(vividpage);
});

// GET /api/vividpages/:id/status - Poll for status updates
router.get('/:id/status', authMiddleware, async (req, res) => {
  const { status, progress_percent, current_step, error_message } =
    await getVividPageStatus(req.params.id);

  res.json({
    status,
    progressPercent: progress_percent,
    currentStep: current_step,
    errorMessage: error_message,
  });
});

// GET /api/vividpages - List user's VividPages
router.get('/', authMiddleware, async (req, res) => {
  const vividpages = await db.query.vividpages.findMany({
    where: eq(vividpages.userId, req.user!.id),
    orderBy: [desc(vividpages.createdAt)],
  });

  res.json(vividpages);
});
```

**Checklist:**
- [ ] Create VividPage CRUD endpoints
- [ ] Add status polling endpoint
- [ ] Implement user's bookcase list endpoint
- [ ] Add pagination for large libraries
- [ ] Add filtering and sorting
- [ ] Optimize database queries

---

### Task 2.6: Frontend - Bookcase UI ✅

**Bookcase Component:**

```typescript
// frontend/src/pages/Bookcase.tsx
import { useEffect, useState } from 'react';
import { getMyVividPages } from '../lib/api';

const Bookcase: React.FC = () => {
  const [vividpages, setVividpages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVividPages();
  }, []);

  const loadVividPages = async () => {
    const data = await getMyVividPages();
    setVividpages(data);
    setLoading(false);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">My Bookcase</h1>

      {/* Upload Button */}
      <UploadEpub onUploadComplete={loadVividPages} />

      {/* VividPages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 mt-8">
        {vividpages.map(vp => (
          <VividPageCard key={vp.id} vividpage={vp} />
        ))}
      </div>

      {vividpages.length === 0 && !loading && (
        <EmptyState />
      )}
    </div>
  );
};
```

**VividPage Card:**

```typescript
const VividPageCard: React.FC<{ vividpage: VividPage }> = ({ vividpage }) => {
  const statusColor = {
    parsing: 'bg-yellow-500',
    scenes_detected: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  }[vividpage.status];

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Cover Image */}
      <div className="h-64 bg-gray-200 relative">
        {vividpage.coverImageUrl ? (
          <img src={vividpage.coverImageUrl} alt={vividpage.title} />
        ) : (
          <div className="flex items-center justify-center h-full">
            📚
          </div>
        )}

        {/* Status Badge */}
        <div className={`absolute top-2 right-2 ${statusColor} text-white px-2 py-1 rounded text-sm`}>
          {vividpage.status}
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-lg truncate">{vividpage.title}</h3>
        <p className="text-gray-600 text-sm">{vividpage.author}</p>

        {/* Progress Bar */}
        {vividpage.status !== 'completed' && (
          <div className="mt-3">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all"
                style={{ width: `${vividpage.progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{vividpage.currentStep}</p>
          </div>
        )}

        {/* Stats */}
        {vividpage.status === 'completed' && (
          <div className="flex justify-between mt-3 text-sm text-gray-600">
            <span>{vividpage.totalScenes} scenes</span>
            <span>{vividpage.totalStoryboards} images</span>
          </div>
        )}
      </div>
    </div>
  );
};
```

**Checklist:**
- [ ] Create Bookcase page component
- [ ] Build VividPage card component
- [ ] Add status badges and colors
- [ ] Implement progress bars
- [ ] Add empty state
- [ ] Create upload modal/component
- [ ] Add loading states
- [ ] Add click to view details

---

### Task 2.7: Real-time Progress Updates ✅

**Option 1: Polling (Simpler)**

```typescript
// Poll every 3 seconds
useEffect(() => {
  if (processingVividPageId) {
    const interval = setInterval(async () => {
      const status = await getVividPageStatus(processingVividPageId);
      updateVividPageInList(status);

      if (status.status === 'completed' || status.status === 'failed') {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }
}, [processingVividPageId]);
```

**Option 2: WebSocket (Better UX)**

```typescript
// backend/src/api/server.ts
import { Server } from 'socket.io';

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  socket.on('subscribe:vividpage', (vividpageId) => {
    socket.join(`vividpage:${vividpageId}`);
  });
});

// In worker, emit updates
io.to(`vividpage:${vividpageId}`).emit('progress', {
  progressPercent: 60,
  currentStep: 'Detecting scenes...',
});
```

**Frontend WebSocket:**

```typescript
import { io } from 'socket.io-client';

const socket = io(API_URL);

socket.emit('subscribe:vividpage', vividpageId);

socket.on('progress', (data) => {
  setProgress(data.progressPercent);
  setCurrentStep(data.currentStep);
});
```

**Checklist:**
- [ ] Choose polling or WebSocket
- [ ] Implement progress updates
- [ ] Update UI in real-time
- [ ] Handle connection errors
- [ ] Test with slow processing

---

## Testing Strategy

### Unit Tests
- EPUB parsing with valid files
- Scene detection accuracy
- MinIO upload/download
- Job queue operations

### Integration Tests
- Full upload → parse → display workflow
- Error handling (corrupted EPUB)
- Multiple concurrent uploads
- Progress tracking accuracy

### Manual Testing
- Upload various EPUB files:
  - Short story (10 pages)
  - Novella (100 pages)
  - Full novel (300+ pages)
- Verify all metadata extracted
- Check scene boundaries make sense
- Verify bookcase displays correctly

---

## Dependencies to Install

```json
{
  "dependencies": {
    "minio": "^8.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "epub": "^1.2.1",
    "multer": "^1.4.5-lts.1",
    "socket.io": "^4.6.0",
    "socket.io-client": "^4.6.0"
  },
  "devDependencies": {
    "@types/multer": "^1.4.11",
    "@types/epub": "^1.2.3"
  }
}
```

---

## Success Criteria

### Phase 2 Complete When:

✅ User can upload EPUB file via drag-and-drop
✅ EPUB is validated and stored in MinIO
✅ Worker automatically processes EPUB
✅ Metadata (title, author, cover) extracted
✅ Chapters are parsed correctly
✅ Scenes are detected and stored
✅ VividPage appears in bookcase
✅ Processing status updates in real-time
✅ Progress bar shows accurate progress
✅ Can view VividPage details
✅ Error handling for failed uploads
✅ Can process multiple EPUBs concurrently

---

## Git Workflow

After completing each major task:

```bash
git add .
git commit -m "Phase 2.X: [Task name]"
```

Final commit:
```bash
git commit -m "Phase 2 complete: EPUB processing"
```

---

## Next Phase Preview

**Phase 3: LLM Integration**
- Use parsed scenes for character extraction
- Scene-by-scene analysis
- Generate image prompts
- Prepare for storyboard generation

---

**Ready to start Phase 2!** 🚀

Let's begin with Task 2.1: File Upload System
