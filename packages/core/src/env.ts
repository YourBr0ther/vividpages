import { z } from 'zod';

/**
 * Environment configuration for VividPages.
 *
 * getEnv() is a pure process.env reader — it never loads dotenv. Each
 * entrypoint is responsible for populating process.env first:
 *   - apps/web: Next.js loads .env files itself.
 *   - apps/worker: loads the repo-root .env via dotenv at the very top of
 *     its entrypoint, before calling getEnv().
 *   - tests: set process.env directly (see resetEnvForTests).
 */
const envSchema = z.object({
  DATABASE_URL: z.url({ error: 'must be a Postgres connection URL' }),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  MINIO_ENDPOINT: z.url({ error: 'must be the MinIO endpoint URL' }),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  OLLAMA_URL: z.url().default('http://10.0.2.192:11434'),
  COMFYUI_URL: z.url().default('http://10.0.2.192:8000'),
  AUTH_SECRET: z.string().min(16, { error: 'must be at least 16 characters' }),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/, { error: 'must be 64 lowercase hex chars (openssl rand -hex 32)' }),
  WORKER_CONCURRENCY_INGEST: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_SEGMENT: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_ANALYZE: z.coerce.number().int().positive().default(1),
  WORKER_CONCURRENCY_PROFILES: z.coerce.number().int().positive().default(1),
  WORKER_CONCURRENCY_IMAGINE: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Lazy singleton: parses process.env once on first access and caches the
 * result. Throws a single error listing every missing/invalid variable so a
 * misconfigured deployment surfaces all problems at once.
 */
export function getEnv(): Env {
  if (!cached) {
    // Treat empty strings as unset so blank lines in .env files (e.g.
    // `AUTH_SECRET=`) don't sneak past validation or suppress defaults.
    const source = Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
    );
    const result = envSchema.safeParse(source);
    if (!result.success) {
      const problems = result.error.issues.map((issue) => {
        const name = issue.path.join('.');
        const missing = !(name in source);
        return `  - ${name}: ${missing ? 'missing' : issue.message}`;
      });
      throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
    }
    cached = result.data;
  }
  return cached;
}

/** Clears the cached env so tests can re-parse a mutated process.env. */
export function resetEnvForTests(): void {
  cached = undefined;
}
