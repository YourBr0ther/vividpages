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
  epubFilename: varchar('epub_filename', { length: 255 }).notNull(),
  epubPath: varchar('epub_path', { length: 1000 }).notNull(),
  coverImagePath: varchar('cover_image_path', { length: 1000 }),

  // Generation settings
  stylePreset: varchar('style_preset', { length: 50 }).notNull(),
  llmModel: varchar('llm_model', { length: 100 }).notNull(),
  imageModel: varchar('image_model', { length: 100 }).notNull(),
  settings: jsonb('settings').notNull(),

  // Status
  status: varchar('status', { length: 50 }).default('processing').notNull(),
  errorMessage: text('error_message'),

  // Statistics
  totalChapters: integer('total_chapters'),
  totalScenes: integer('total_scenes'),
  totalStoryboards: integer('total_storyboards'),
  totalCharacters: integer('total_characters'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

  jobType: varchar('job_type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('queued').notNull(),

  progressPercent: integer('progress_percent').default(0),
  currentStep: varchar('current_step', { length: 255 }),
  errorMessage: text('error_message'),

  metadata: jsonb('metadata'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    vividPageIdIdx: index('idx_jobs_vivid_page_id').on(table.vividPageId),
    statusIdx: index('idx_jobs_status').on(table.status),
    createdAtIdx: index('idx_jobs_created_at').on(table.createdAt),
  };
});

// ============================================
// Relations
// ============================================
export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  vividPages: many(vividPages),
  sessions: many(sessions),
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
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  vividPage: one(vividPages, {
    fields: [jobs.vividPageId],
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
