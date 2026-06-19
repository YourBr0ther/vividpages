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
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

// Column names are derived from TS property names via `casing: 'snake_case'`
// (set in drizzle.config.ts and in the drizzle() client in index.ts).

// ---------------------------------------------------------------------------
// Status / enum unions (TS-only via .$type<>(); stored as plain text)
// ---------------------------------------------------------------------------

export type UserRole = 'user' | 'admin';
export type BookStatus =
  | 'uploading'
  | 'ingesting'
  | 'segmenting'
  | 'analyzing'
  | 'profiling'
  | 'imagining'
  | 'ready'
  | 'failed';
export type SceneAnalysisStatus = 'pending' | 'done' | 'failed';
export type ImageKind = 'character_portrait' | 'scene_storyboard' | 'book_cover';
export type ImageStatus = 'pending' | 'generating' | 'done' | 'failed';
export type PipelineRunStatus = 'running' | 'done' | 'failed';
export type ApiKeyProvider = 'anthropic' | 'openai';

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
  role: text().$type<UserRole>().notNull().default('user'),
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
  /**
   * Pre-fills `books.matureContent` for new uploads: when on, the pipeline
   * instructs the (user-controlled, local) model to faithfully depict mature
   * source content rather than euphemizing it. Default off.
   */
  matureContentDefault: boolean().notNull().default(false),
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
    provider: text().$type<ApiKeyProvider>().notNull(),
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
    status: text().$type<BookStatus>().notNull().default('uploading'),
    error: text(),
    stylePresetId: uuid().references(() => stylePresets.id, {
      onDelete: 'set null',
    }),
    wordCount: integer(),
    /** Providers/models chosen at upload; null = user defaults. */
    llmProvider: text(),
    llmModel: text(),
    imageProvider: text(),
    /**
     * Effective per-book flag, seeded from `user_settings.matureContentDefault`
     * at upload and overridable in book settings. When on, the pipeline's three
     * LLM stages instruct the model to depict mature source content faithfully.
     */
    matureContent: boolean().notNull().default(false),
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
    analysisStatus: text().$type<SceneAnalysisStatus>().notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('scenes_chapter_idx_unique').on(t.chapterId, t.idx),
    // The global index is the reading-progress cursor; it must be unique
    // within a book (also serves the book-wide ordered lookup).
    unique('scenes_book_global_idx_unique').on(t.bookId, t.globalIdx),
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
    /**
     * Optional per-character LoRA (issue #2). All three are nullable; a
     * character is LoRA-enabled only when `loraName` is set, and a null
     * `loraName` means today's behavior (no graph surgery, unchanged prompt).
     */
    loraName: text(),
    /** Optional trigger word woven into the subject phrase (null/empty → none). */
    loraKeyword: text(),
    /** LoRA strength for both model+clip; app applies 1.0 when null. */
    loraStrength: real(),
    embedding: vector({ dimensions: 768 }),
    embeddingModel: text(),
    sceneCount: integer().notNull().default(0),
    /**
     * Immutable, clothing-stripped physical descriptor (face/build/hair/etc.)
     * reused across every appearance state so only the wardrobe varies. Null
     * until the wardrobe extraction populates it (later chunk).
     */
    bodyModel: text(),
    /**
     * Opt-in flag letting a minor character receive the full wardrobe (multiple
     * appearance states) instead of just a body model + single base outfit.
     */
    wardrobeUpgraded: boolean().notNull().default(false),
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

/**
 * A single wardrobe/appearance state for a character. The body model
 * (`characters.bodyModel`) stays constant; each state layers a clothing
 * descriptor on top. One row is the `base` outfit; others are `additional`
 * outfits. Phase 4 will also store `underwear` | `nude` states here.
 */
export const characterAppearanceStates = pgTable(
  'character_appearance_states',
  {
    id: uuid().primaryKey().defaultRandom(),
    characterId: uuid()
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /**
     * Allowed values: 'base' | 'additional' (now), plus 'underwear' | 'nude'
     * (Phase 4). Kept as plain text — NOT a pg enum — so adding the mature
     * states later needs no migration.
     */
    type: text().notNull(),
    /** Structured clothing descriptor woven into image prompts. */
    descriptor: text().notNull(),
    /** Exactly one base per character (enforced in app code, not the DB). */
    isBase: boolean().notNull().default(false),
    /** Scene-mention frequency; drives single-base selection. */
    sceneMentions: integer().notNull().default(0),
    /** Set once the reference model image is generated (later chunk). */
    imageObjectKey: text(),
    thumbObjectKey: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('character_appearance_states_character_idx').on(t.characterId)],
);

export type CharacterAppearanceState =
  typeof characterAppearanceStates.$inferSelect;
export type NewCharacterAppearanceState =
  typeof characterAppearanceStates.$inferInsert;

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
    kind: text().$type<ImageKind>().notNull(),
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
    status: text().$type<ImageStatus>().notNull().default('pending'),
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
// Illustration points (planning output, one row per planned moment)
// ---------------------------------------------------------------------------

export const illustrationPoints = pgTable(
  'illustration_points',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookId: uuid()
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chapterId: uuid()
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    /**
     * The pipeline_runs id of the run that planned this point (no FK — just the
     * stamp). Lets imagine Phase 0 distinguish a fresh "Generate art" run (no
     * points, or points stamped by an older run → rebuild + re-plan) from a
     * BullMQ retry of the SAME run (all points carry this runId → skip the
     * re-plan and resume generation against the stable point ids). Nullable for
     * rows planned before this column existed.
     */
    runId: uuid(),
    /** Order of the point within the chapter (by char offset). */
    idx: integer().notNull(),
    /** Paragraph offset into `chapters.text` for inline placement. */
    charOffset: integer().notNull(),
    /** Verbatim sentence the LLM keyed on (locates offset; debug). */
    anchorQuote: text().notNull(),
    /** Visual description fed to the image prompt. */
    momentDescription: text().notNull(),
    /** Cast present at the moment, for the prompt's appearance tokens. */
    presentCharacterIds: text()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** LLM importance rank (top-N selection + future tuning). */
    score: real(),
    /**
     * Per-scene appearance assignment: map of characterId → appearance state id
     * (`character_appearance_states.id`) chosen for this point. Populated by the
     * per-scene state-mapping step (later chunk); null until then.
     */
    characterStates: jsonb().$type<Record<string, string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('illustration_points_chapter_idx_unique').on(t.chapterId, t.idx),
    index('illustration_points_book_idx').on(t.bookId),
  ],
);

export type IllustrationPoint = typeof illustrationPoints.$inferSelect;

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
    status: text().$type<PipelineRunStatus>().notNull().default('running'),
    tokensIn: bigint({ mode: 'number' }).notNull().default(0),
    tokensOut: bigint({ mode: 'number' }).notNull().default(0),
    error: text(),
    startedAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('pipeline_runs_book_idx').on(t.bookId),
    // Concurrent-run fence: at most ONE 'running' run per book, enforced by
    // the database (the API's friendly pre-check races; this doesn't). The
    // accompanying migration (0002) first marks stale 'running' rows as
    // failed ('superseded') so the index can build on existing data.
    uniqueIndex('pipeline_runs_book_running_unique')
      .on(t.bookId)
      .where(sql`${t.status} = 'running'`),
  ],
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
