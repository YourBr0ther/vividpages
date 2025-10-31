# VividPages - Database Schema Design

**Version:** 1.0
**Date:** October 31, 2025
**Database:** PostgreSQL 15+ with pgvector

---

## Schema Overview

The database is organized into several logical domains:

1. **User Management** - Authentication and profile data
2. **API Key Management** - Encrypted third-party API credentials
3. **VividPages** - Book metadata and generation settings
4. **Processing Jobs** - Async job tracking
5. **Book Content** - Chapters, scenes, and parsed content
6. **Characters** - Character data and consistency tracking
7. **Settings/Locations** - Scene locations and environments
8. **Storyboards** - Generated images and metadata
9. **Embeddings** - Vector data for similarity search

---

## Entity Relationship Diagram

```
┌─────────────┐
│    Users    │
└──────┬──────┘
       │
       ├──────┬────────┬──────────┬────────────┐
       │      │        │          │            │
       ▼      ▼        ▼          ▼            ▼
┌──────────┐  │  ┌───────────┐   │      ┌──────────┐
│API Keys  │  │  │VividPages │   │      │Sessions  │
└──────────┘  │  └─────┬─────┘   │      └──────────┘
              │        │         │
              │        ├─────────┼─────────┬─────────────┐
              │        │         │         │             │
              │        ▼         ▼         ▼             ▼
              │   ┌────────┐ ┌──────┐ ┌───────────┐ ┌─────────┐
              │   │  Jobs  │ │Scenes│ │Characters │ │Settings │
              │   └────────┘ └───┬──┘ └─────┬─────┘ └────┬────┘
              │              ┌───┴────┐     │            │
              │              ▼        │     ▼            ▼
              │         ┌────────────┐│┌──────────┐ ┌─────────────┐
              │         │Storyboards │││Character │ │   Setting   │
              │         │            │││ Changes  │ │  Embeddings │
              │         └────┬───────┘│└──────────┘ └─────────────┘
              │              │        │
              │              ▼        │
              │         ┌────────────┐│
              │         │Storyboard  ││
              │         │  History   ││
              │         └────────────┘│
              │                       │
              │                       ▼
              │                  ┌──────────────┐
              │                  │  Character   │
              └──────────────────│  Embeddings  │
                                 └──────────────┘
```

---

## Detailed Schema Definitions

### 1. Users Table

Stores user authentication and profile information.

```typescript
// Drizzle ORM Schema
import { pgTable, uuid, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }), // null for SSO-only users
  googleId: varchar('google_id', { length: 255 }).unique(),
  fullName: varchar('full_name', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
});

// Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);
```

**Columns:**
- `id` - UUID primary key
- `email` - User's email (unique)
- `password_hash` - Bcrypt hash (null for SSO users)
- `google_id` - Google OAuth ID (null for local users)
- `full_name` - Display name
- `avatar_url` - Profile picture URL
- `is_active` - Account status
- `email_verified` - Email verification status
- `created_at` - Account creation timestamp
- `updated_at` - Last update timestamp
- `last_login_at` - Last login time

---

### 2. API Keys Table

Stores encrypted API credentials for third-party services.

```typescript
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(), // 'claude', 'openai', 'stable-diffusion', etc.
  encryptedKey: text('encrypted_key').notNull(),
  nickname: varchar('nickname', { length: 100 }), // User-friendly name
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_provider ON api_keys(provider);
```

**Columns:**
- `id` - UUID primary key
- `user_id` - Foreign key to users
- `provider` - Service name (claude, openai, stable-diffusion, etc.)
- `encrypted_key` - AES-256 encrypted API key
- `nickname` - Optional user label ("My Personal OpenAI Key")
- `is_active` - Whether key is currently usable
- `created_at` - When key was added
- `updated_at` - Last update

**Encryption Note:** Keys encrypted using `crypto-js` with master key from env.

---

### 3. VividPages Table

Represents a generated book with storyboards.

```typescript
export const vividPages = pgTable('vivid_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

  // Book metadata
  title: varchar('title', { length: 500 }).notNull(),
  author: varchar('author', { length: 255 }),
  epubFilename: varchar('epub_filename', { length: 255 }).notNull(),
  epubPath: varchar('epub_path', { length: 1000 }).notNull(), // S3/MinIO path
  coverImagePath: varchar('cover_image_path', { length: 1000 }),

  // Generation settings
  stylePreset: varchar('style_preset', { length: 50 }).notNull(), // 'fantasy', 'scifi', etc.
  llmModel: varchar('llm_model', { length: 100 }).notNull(), // 'claude-3-opus', 'gpt-4', etc.
  imageModel: varchar('image_model', { length: 100 }).notNull(), // 'dall-e-3', 'stable-diffusion', etc.

  // User preferences stored as JSON
  settings: jsonb('settings').notNull(),
  /* settings schema:
  {
    storyboardDensity: 'per-paragraph' | 'per-chapter' | 'custom',
    storyboardsPerChapter: number,
    includeSpeakerStoryboards: boolean,
    imageResolution: '720x720' | '1080x1080',
    customInstructions: string
  }
  */

  // Status
  status: varchar('status', { length: 50 }).default('processing').notNull(), // 'processing', 'completed', 'failed'
  errorMessage: text('error_message'),

  // Statistics
  totalChapters: integer('total_chapters'),
  totalScenes: integer('total_scenes'),
  totalStoryboards: integer('total_storyboards'),
  totalCharacters: integer('total_characters'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Indexes
CREATE INDEX idx_vivid_pages_user_id ON vivid_pages(user_id);
CREATE INDEX idx_vivid_pages_status ON vivid_pages(status);
CREATE INDEX idx_vivid_pages_created_at ON vivid_pages(created_at DESC);
```

**Key Fields:**
- `settings` - JSON blob for flexible configuration
- `status` - Tracks generation progress
- `*_count` fields - For quick stats display

---

### 4. Jobs Table

Tracks async background processing jobs.

```typescript
export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),

  jobType: varchar('job_type', { length: 50 }).notNull(), // 'epub-parse', 'llm-analysis', 'image-generation'
  status: varchar('status', { length: 50 }).default('queued').notNull(), // 'queued', 'processing', 'completed', 'failed'

  progressPercent: integer('progress_percent').default(0),
  currentStep: varchar('current_step', { length: 255 }),
  errorMessage: text('error_message'),

  // Job metadata
  metadata: jsonb('metadata'), // Job-specific data

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
});

// Indexes
CREATE INDEX idx_jobs_vivid_page_id ON jobs(vivid_page_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

**Job Types:**
- `epub-parse` - Initial EPUB processing
- `llm-analysis` - Character and scene analysis
- `image-generation` - Storyboard creation
- `image-regeneration` - Single storyboard redo

---

### 5. Scenes Table

Parsed scenes/segments from the book.

```typescript
export const scenes = pgTable('scenes', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),

  chapterNumber: integer('chapter_number').notNull(),
  sceneNumber: integer('scene_number').notNull(), // Scene within chapter

  textContent: text('text_content').notNull(),
  wordCount: integer('word_count'),

  // LLM analysis results
  llmAnalysis: jsonb('llm_analysis'),
  /* llmAnalysis schema:
  {
    characters: string[], // Character IDs present
    settingId: string,
    description: string,
    mood: string,
    timeOfDay: string,
    weather: string,
    keyVisualElements: string[]
  }
  */

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_scenes_vivid_page_id ON scenes(vivid_page_id);
CREATE INDEX idx_scenes_chapter_scene ON scenes(chapter_number, scene_number);
```

---

### 6. Characters Table

Identified characters from the book.

```typescript
export const characters = pgTable('characters', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),

  name: varchar('name', { length: 255 }).notNull(),
  aliases: text('aliases').array(), // Alternative names

  // Initial appearance
  initialAppearance: jsonb('initial_appearance').notNull(),
  /* initialAppearance schema:
  {
    physicalDescription: string,
    age: string,
    height: string,
    build: string,
    hairColor: string,
    hairStyle: string,
    eyeColor: string,
    skinTone: string,
    distinctiveFeatures: string[],
    typicalClothing: string
  }
  */

  // Reference image for consistency
  referenceImagePath: varchar('reference_image_path', { length: 1000 }),

  // Character metadata
  role: varchar('role', { length: 50 }), // 'protagonist', 'antagonist', 'supporting'
  firstAppearanceScene: uuid('first_appearance_scene').references(() => scenes.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_characters_vivid_page_id ON characters(vivid_page_id);
CREATE INDEX idx_characters_name ON characters(name);
```

---

### 7. Character Changes Table

Tracks physical changes to characters over the story.

```typescript
export const characterChanges = pgTable('character_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }).notNull(),
  sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'cascade' }).notNull(),

  changeType: varchar('change_type', { length: 50 }).notNull(), // 'outfit', 'injury', 'hair', 'age', 'other'
  description: text('description').notNull(),

  // For prompt modification
  promptModifier: text('prompt_modifier'), // Text to add to prompts after this scene

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_character_changes_character_id ON character_changes(character_id);
CREATE INDEX idx_character_changes_scene_id ON character_changes(scene_id);
```

**Example:**
- Scene 45: "Elara loses her left eye in battle"
- `changeType`: 'injury'
- `description`: "Lost left eye, now wears eyepatch"
- `promptModifier`: "wearing a black eyepatch over left eye"

---

### 8. Settings Table

Locations and environments in the book.

```typescript
export const settings = pgTable('settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),

  name: varchar('name', { length: 255 }).notNull(), // "Dark Forest", "Castle Throne Room"
  description: text('description').notNull(),

  // Visual consistency
  visualKeywords: text('visual_keywords').array(), // ["ancient trees", "mist", "moonlight"]

  firstAppearanceScene: uuid('first_appearance_scene').references(() => scenes.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_settings_vivid_page_id ON settings(vivid_page_id);
CREATE INDEX idx_settings_name ON settings(name);
```

---

### 9. Storyboards Table

Generated images for scenes.

```typescript
export const storyboards = pgTable('storyboards', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),
  sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'cascade' }).notNull(),

  // Image storage
  imagePath: varchar('image_path', { length: 1000 }).notNull(), // S3/MinIO path
  thumbnailPath: varchar('thumbnail_path', { length: 1000 }).notNull(),

  // Generation details
  promptUsed: text('prompt_used').notNull(),
  generationParams: jsonb('generation_params'),
  /* generationParams schema:
  {
    model: string,
    resolution: string,
    seed: number,
    stylePreset: string,
    negativePrompt: string
  }
  */

  // Version tracking
  versionNumber: integer('version_number').default(1).notNull(),
  isActive: boolean('is_active').default(true).notNull(), // Current version

  // Metadata
  fileSize: integer('file_size'), // bytes
  width: integer('width'),
  height: integer('height'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_storyboards_vivid_page_id ON storyboards(vivid_page_id);
CREATE INDEX idx_storyboards_scene_id ON storyboards(scene_id);
CREATE INDEX idx_storyboards_is_active ON storyboards(is_active);
```

---

### 10. Storyboard History Table

Keeps track of regenerated versions.

```typescript
export const storyboardHistory = pgTable('storyboard_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyboardId: uuid('storyboard_id').references(() => storyboards.id, { onDelete: 'cascade' }).notNull(),

  imagePath: varchar('image_path', { length: 1000 }).notNull(),
  promptUsed: text('prompt_used').notNull(),
  userFeedback: text('user_feedback'), // Why they regenerated
  versionNumber: integer('version_number').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_storyboard_history_storyboard_id ON storyboard_history(storyboard_id);
```

---

### 11. Character Embeddings Table (Vector)

Stores vector embeddings for character consistency.

```typescript
// First, enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

export const characterEmbeddings = pgTable('character_embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }).notNull().unique(),

  // Vector embedding (1536 dimensions for OpenAI ada-002)
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),

  // Metadata for debugging
  model: varchar('model', { length: 100 }).notNull(), // 'text-embedding-ada-002'

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Vector similarity index (HNSW for fast approximate nearest neighbor)
CREATE INDEX idx_character_embeddings_vector ON character_embeddings
USING hnsw (embedding vector_cosine_ops);
```

**Usage:** Find similar character descriptions for consistency checks.

---

### 12. Setting Embeddings Table (Vector)

Stores vector embeddings for location consistency.

```typescript
export const settingEmbeddings = pgTable('setting_embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  settingId: uuid('setting_id').references(() => settings.id, { onDelete: 'cascade' }).notNull().unique(),

  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

CREATE INDEX idx_setting_embeddings_vector ON setting_embeddings
USING hnsw (embedding vector_cosine_ops);
```

---

### 13. Sessions Table (Optional)

For session-based auth (alternative to JWT-only).

```typescript
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

// Cleanup expired sessions periodically
CREATE INDEX idx_sessions_cleanup ON sessions(expires_at) WHERE expires_at < NOW();
```

---

## Sample Queries

### 1. Get User's VividPages with Stats

```sql
SELECT
  vp.id,
  vp.title,
  vp.author,
  vp.cover_image_path,
  vp.status,
  vp.total_storyboards,
  vp.created_at,
  vp.completed_at
FROM vivid_pages vp
WHERE vp.user_id = $1
ORDER BY vp.created_at DESC;
```

### 2. Get All Storyboards for a VividPage

```sql
SELECT
  sb.id,
  sb.scene_id,
  s.chapter_number,
  s.scene_number,
  sb.image_path,
  sb.thumbnail_path,
  sb.version_number
FROM storyboards sb
JOIN scenes s ON s.id = sb.scene_id
WHERE sb.vivid_page_id = $1
  AND sb.is_active = true
ORDER BY s.chapter_number, s.scene_number;
```

### 3. Get Character with Changes Up To Scene

```sql
SELECT
  c.*,
  ARRAY_AGG(
    json_build_object(
      'changeType', cc.change_type,
      'description', cc.description,
      'promptModifier', cc.prompt_modifier
    ) ORDER BY cc.created_at
  ) FILTER (WHERE cc.scene_id <= $2) as changes
FROM characters c
LEFT JOIN character_changes cc ON cc.character_id = c.id
WHERE c.id = $1
GROUP BY c.id;
```

### 4. Find Similar Characters (Vector Search)

```sql
SELECT
  c.id,
  c.name,
  c.initial_appearance,
  1 - (ce.embedding <=> $1) as similarity
FROM character_embeddings ce
JOIN characters c ON c.id = ce.character_id
WHERE c.vivid_page_id = $2
ORDER BY ce.embedding <=> $1
LIMIT 5;
```
*Note: `<=>` is cosine distance operator in pgvector*

### 5. Get Job Progress

```sql
SELECT
  j.id,
  j.job_type,
  j.status,
  j.progress_percent,
  j.current_step,
  j.created_at,
  j.started_at
FROM jobs j
WHERE j.vivid_page_id = $1
ORDER BY j.created_at DESC;
```

---

## Drizzle ORM Relationships

```typescript
// Define relations for easier queries
import { relations } from 'drizzle-orm';

export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  vividPages: many(vividPages),
}));

export const vividPagesRelations = relations(vividPages, ({ one, many }) => ({
  user: one(users, {
    fields: [vividPages.userId],
    references: [users.id],
  }),
  jobs: many(jobs),
  scenes: many(scenes),
  characters: many(characters),
  settings: many(settings),
  storyboards: many(storyboards),
}));

export const scenesRelations = relations(scenes, ({ one, many }) => ({
  vividPage: one(vividPages, {
    fields: [scenes.vividPageId],
    references: [vividPages.id],
  }),
  storyboards: many(storyboards),
}));

// ... etc for other tables
```

---

## Migration Strategy

### Initial Setup

```bash
# Generate migration
pnpm drizzle-kit generate:pg

# Apply migration
pnpm drizzle-kit push:pg
```

### Migration Files

Drizzle generates SQL migration files:

```sql
-- 0001_initial_schema.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  -- ... rest of schema
);

-- ... all tables
```

---

## Backup & Restore

### Backup Strategy

```bash
# Full database backup
docker exec vividpages-postgres pg_dump -U vividpages vividpages > backup_$(date +%Y%m%d).sql

# Backup with compression
docker exec vividpages-postgres pg_dump -U vividpages vividpages | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Restore

```bash
# Restore from backup
docker exec -i vividpages-postgres psql -U vividpages vividpages < backup_20261231.sql
```

### Automated Backups (Future)

Add to docker-compose or cron:
```bash
0 2 * * * /path/to/backup-script.sh
```

---

## Performance Considerations

### Indexes

All critical foreign keys and frequently queried columns are indexed:
- User lookups (email, google_id)
- VividPage queries (user_id, status, created_at)
- Job tracking (vivid_page_id, status)
- Storyboard retrieval (scene_id, is_active)
- Vector similarity (HNSW indexes)

### Partitioning (Future)

If storyboards table grows very large (millions of rows):
```sql
-- Partition by vivid_page_id or created_at
CREATE TABLE storyboards_2026_01 PARTITION OF storyboards
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

### Query Optimization

- Use `EXPLAIN ANALYZE` for slow queries
- Consider materialized views for complex aggregations
- Use connection pooling (pg-pool)

---

## Data Retention Policy

### User Data
- Keep indefinitely unless user deletes account
- On account deletion: CASCADE deletes all related data

### Job History
- Keep completed jobs for 30 days
- Keep failed jobs for 90 days (debugging)
- Archive old jobs to separate table or delete

### Storyboard History
- Keep all versions indefinitely (user feature)
- Option to purge old versions to save space

---

## Security Considerations

### Encryption
- API keys encrypted at rest (AES-256)
- Passwords hashed with bcrypt (cost factor 10)
- Sensitive columns never in logs

### Access Control
- Row-level security (RLS) can be enabled
- All queries filter by user_id
- API layer enforces ownership

### SQL Injection
- Drizzle ORM uses parameterized queries
- No raw SQL with user input

---

## Next Steps

1. Set up PostgreSQL with pgvector in Docker
2. Initialize Drizzle ORM
3. Run initial migrations
4. Seed development data (optional)
5. Begin API implementation

**Status:** ✅ Schema Finalized
**Next Document:** Phased Development & Deployment Guide
