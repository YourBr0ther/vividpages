import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

// Column names are derived from TS property names via `casing: 'snake_case'`
// (set in drizzle.config.ts and in the drizzle() client in index.ts).

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Auth.js (@auth/drizzle-adapter) tables
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text(),
  email: text().unique(),
  emailVerified: timestamp({ mode: 'date', withTimezone: true }),
  image: text(),
  /** Null for OAuth-only users. */
  passwordHash: text(),
  role: text().notNull().default('user'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().$type<'oauth' | 'oidc' | 'email' | 'webauthn'>().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp({ mode: 'date', withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// User configuration
// ---------------------------------------------------------------------------

export const userSettings = pgTable('user_settings', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  llmProvider: text().notNull().default('ollama'),
  llmModel: text().notNull().default('llama3.1:8b'),
  embeddingProvider: text().notNull().default('ollama'),
  embeddingModel: text().notNull().default('nomic-embed-text'),
  imageProvider: text().notNull().default('comfyui'),
  imageModel: text(),
  /** Null = use environment defaults. */
  ollamaUrl: text(),
  comfyuiUrl: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'anthropic' | 'openai' */
    provider: text().notNull(),
    /** AES-256-GCM ciphertext (iv + tag + data); never returned decrypted. */
    ciphertext: text().notNull(),
    label: text(),
    lastFour: text(),
    createdAt: createdAt(),
  },
  (t) => [unique('api_keys_user_provider_unique').on(t.userId, t.provider)],
);

export const stylePresets = pgTable('style_presets', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  promptFragment: text().notNull(),
  negativeFragment: text(),
  builtIn: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Books & text
// ---------------------------------------------------------------------------

export const books = pgTable(
  'books',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    author: text(),
    language: text(),
    isbn: text(),
    sha256: text().notNull(),
    coverObjectKey: text(),
    epubObjectKey: text(),
    /** uploading | ingesting | segmenting | analyzing | profiling | imagining | ready | failed */
    status: text().notNull().default('uploading'),
    error: text(),
    stylePresetId: uuid().references(() => stylePresets.id),
    wordCount: integer(),
    /** Providers/models chosen at upload; null = user defaults. */
    llmProvider: text(),
    llmModel: text(),
    imageProvider: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('books_user_sha256_unique').on(t.userId, t.sha256),
    index('books_user_status_idx').on(t.userId, t.status),
  ],
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    idx: integer().notNull(),
    title: text(),
    text: text().notNull(),
    /** Character offsets of paragraphs into `text`. */
    paragraphs: jsonb().$type<Array<{ start: number; end: number }>>(),
    /** Character offsets of explicit scene-break markers. */
    sceneBreaks: jsonb().$type<number[]>(),
    wordCount: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('chapters_book_idx_unique').on(t.bookId, t.idx)],
);

export const scenes = pgTable(
  'scenes',
  {
    id: uuid().primaryKey().defaultRandom(),
    chapterId: uuid()
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    /** Denormalized for cheap book-wide queries. */
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    /** Index within chapter. */
    idx: integer().notNull(),
    /** Index within book. */
    globalIdx: integer().notNull(),
    /** Character offsets into the chapter text. */
    startOffset: integer().notNull(),
    endOffset: integer().notNull(),
    wordCount: integer(),
    summary: text(),
    setting: text(),
    timeOfDay: text(),
    mood: text(),
    sceneType: text(),
    keyVisualMoment: text(),
    /** pending | done | failed */
    analysisStatus: text().notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('scenes_chapter_idx_unique').on(t.chapterId, t.idx),
    index('scenes_book_global_idx').on(t.bookId, t.globalIdx),
  ],
);

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export const characters = pgTable(
  'characters',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    aliases: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    role: text(),
    /** Canonical visual profile (hair, eyes, build, attire, ...). */
    profile: jsonb(),
    /** Stable compiled prompt fragment reused verbatim in every image prompt. */
    appearanceToken: text(),
    embedding: vector({ dimensions: 768 }),
    embeddingModel: text(),
    sceneCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('characters_book_idx').on(t.bookId),
    index('characters_embedding_hnsw_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  ],
);

export const sceneCharacters = pgTable(
  'scene_characters',
  {
    sceneId: uuid()
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    characterId: uuid()
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** Name/epithet used in this scene. */
    mentionName: text(),
    /** New appearance details introduced in this scene. */
    descriptionDelta: text(),
    /** Per-scene state: outfit/injury changes, etc. */
    stateChanges: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.sceneId, t.characterId] })],
);

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const images = pgTable(
  'images',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    /** character_portrait | scene_storyboard | book_cover */
    kind: text().notNull(),
    /** characterId or sceneId depending on kind (no FK; polymorphic). */
    subjectId: uuid(),
    prompt: text(),
    negativePrompt: text(),
    provider: text(),
    model: text(),
    seed: bigint({ mode: 'bigint' }),
    params: jsonb(),
    objectKey: text(),
    thumbObjectKey: text(),
    width: integer(),
    height: integer(),
    /** pending | generating | done | failed */
    status: text().notNull().default('pending'),
    error: text(),
    /** Old versions are kept; highest version wins. */
    version: integer().notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index('images_book_kind_idx').on(t.bookId, t.kind),
    index('images_subject_idx').on(t.subjectId),
  ],
);

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    stage: text().notNull(),
    percent: real().notNull().default(0),
    currentStep: text(),
    /** running | done | failed */
    status: text().notNull().default('running'),
    tokensIn: bigint({ mode: 'number' }).notNull().default(0),
    tokensOut: bigint({ mode: 'number' }).notNull().default(0),
    error: text(),
    startedAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pipeline_runs_book_idx').on(t.bookId)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    queue: text().notNull(),
    bullJobId: text(),
    status: text().notNull(),
    error: text(),
    payload: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobs_book_idx').on(t.bookId)],
);

export const readingProgress = pgTable(
  'reading_progress',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chapterIdx: integer().notNull().default(0),
    sceneGlobalIdx: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId] })],
);
