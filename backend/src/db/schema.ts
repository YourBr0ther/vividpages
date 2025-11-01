import { pgTable, uuid, varchar, timestamp, boolean, text, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================
// Users Table
// ============================================
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  googleId: varchar('google_id', { length: 255 }).unique(),
  fullName: varchar('full_name', { length: 255 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  isActive: boolean('is_active').default(true).notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
}, (table) => {
  return {
    emailIdx: index('idx_users_email').on(table.email),
    googleIdIdx: index('idx_users_google_id').on(table.googleId),
  };
});

// ============================================
// API Keys Table
// ============================================
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  nickname: varchar('nickname', { length: 100 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index('idx_api_keys_user_id').on(table.userId),
    providerIdx: index('idx_api_keys_provider').on(table.provider),
  };
});

// ============================================
// Sessions Table (Optional - for session-based auth)
// ============================================
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index('idx_sessions_user_id').on(table.userId),
    tokenIdx: index('idx_sessions_token').on(table.token),
    expiresAtIdx: index('idx_sessions_expires_at').on(table.expiresAt),
  };
});

// ============================================
// VividPages Table
// ============================================
export const vividPages = pgTable('vivid_pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

  // Book metadata
  title: varchar('title', { length: 500 }).notNull(),
  author: varchar('author', { length: 255 }),
  isbn: varchar('isbn', { length: 20 }),
  language: varchar('language', { length: 10 }).default('en'),
  epubFilename: varchar('epub_filename', { length: 255 }).notNull(),
  epubPath: varchar('epub_path', { length: 1000 }).notNull(),
  epubSizeBytes: integer('epub_size_bytes'),
  coverImagePath: varchar('cover_image_path', { length: 1000 }),

  // Generation settings (optional until user configures)
  stylePreset: varchar('style_preset', { length: 50 }),
  llmModel: varchar('llm_model', { length: 100 }),
  imageModel: varchar('image_model', { length: 100 }),
  settings: jsonb('settings').default({}),

  // Status tracking
  status: varchar('status', { length: 50 }).default('uploading').notNull(),
  // Status values: uploading, parsing, scenes_detected, llm_analysis, generating_images, completed, failed
  progressPercent: integer('progress_percent').default(0),
  currentStep: varchar('current_step', { length: 255 }),
  errorMessage: text('error_message'),

  // Statistics
  totalChapters: integer('total_chapters').default(0),
  totalScenes: integer('total_scenes').default(0),
  totalStoryboards: integer('total_storyboards').default(0),
  totalCharacters: integer('total_characters').default(0),
  wordCount: integer('word_count').default(0),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    userIdIdx: index('idx_vivid_pages_user_id').on(table.userId),
    statusIdx: index('idx_vivid_pages_status').on(table.status),
    createdAtIdx: index('idx_vivid_pages_created_at').on(table.createdAt),
  };
});

// ============================================
// Jobs Table
// ============================================
export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

  jobType: varchar('job_type', { length: 50 }).notNull(),
  // Job types: epub_parsing, llm_analysis, image_generation, regeneration
  status: varchar('status', { length: 50 }).default('queued').notNull(),
  // Status: queued, processing, completed, failed

  progressPercent: integer('progress_percent').default(0),
  currentStep: varchar('current_step', { length: 255 }),
  errorMessage: text('error_message'),

  bullJobId: varchar('bull_job_id', { length: 100 }),
  attempts: integer('attempts').default(0),
  maxAttempts: integer('max_attempts').default(3),

  metadata: jsonb('metadata'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    vividPageIdIdx: index('idx_jobs_vivid_page_id').on(table.vividPageId),
    userIdIdx: index('idx_jobs_user_id').on(table.userId),
    statusIdx: index('idx_jobs_status').on(table.status),
    jobTypeIdx: index('idx_jobs_job_type').on(table.jobType),
    createdAtIdx: index('idx_jobs_created_at').on(table.createdAt),
  };
});

// ============================================
// Scenes Table
// ============================================
export const scenes = pgTable('scenes', {
  id: uuid('id').defaultRandom().primaryKey(),
  vividPageId: uuid('vivid_page_id').references(() => vividPages.id, { onDelete: 'cascade' }).notNull(),

  // Scene position
  chapterNumber: integer('chapter_number').notNull(),
  chapterTitle: varchar('chapter_title', { length: 500 }),
  sceneNumber: integer('scene_number').notNull(),
  sceneIndexGlobal: integer('scene_index_global').notNull(),

  // Content
  textContent: text('text_content').notNull(),
  wordCount: integer('word_count').notNull(),

  // Scene metadata
  sceneType: varchar('scene_type', { length: 50 }).default('narrative'),
  // Types: narrative, dialogue, action, description, transition
  hasDialogue: boolean('has_dialogue').default(false),
  characterCount: integer('character_count').default(0),

  // LLM Analysis (populated in Phase 3)
  llmAnalysis: jsonb('llm_analysis'),
  imagePrompt: text('image_prompt'),

  // Storyboard (populated in Phase 4)
  storyboardId: uuid('storyboard_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    vividPageIdIdx: index('idx_scenes_vivid_page_id').on(table.vividPageId),
    chapterIdx: index('idx_scenes_chapter').on(table.vividPageId, table.chapterNumber),
    globalIdx: index('idx_scenes_global').on(table.vividPageId, table.sceneIndexGlobal),
  };
});

// ============================================
// Relations
// ============================================
export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  vividPages: many(vividPages),
  sessions: many(sessions),
  jobs: many(jobs),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const vividPagesRelations = relations(vividPages, ({ one, many }) => ({
  user: one(users, {
    fields: [vividPages.userId],
    references: [users.id],
  }),
  jobs: many(jobs),
  scenes: many(scenes),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  vividPage: one(vividPages, {
    fields: [jobs.vividPageId],
    references: [vividPages.id],
  }),
  user: one(users, {
    fields: [jobs.userId],
    references: [users.id],
  }),
}));

export const scenesRelations = relations(scenes, ({ one }) => ({
  vividPage: one(vividPages, {
    fields: [scenes.vividPageId],
    references: [vividPages.id],
  }),
}));

// ============================================
// Type Exports
// ============================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type VividPage = typeof vividPages.$inferSelect;
export type NewVividPage = typeof vividPages.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type Scene = typeof scenes.$inferSelect;
export type NewScene = typeof scenes.$inferInsert;
