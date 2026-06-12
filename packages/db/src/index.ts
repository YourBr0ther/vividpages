import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export * from './schema';
export { schema };

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let instance: Db | undefined;

/**
 * Lazy singleton: the pg Pool is only created on first call, so importing this
 * package (e.g. from build-time code) never opens connections.
 *
 * Requires DATABASE_URL to be set; there is intentionally no fallback here
 * (the localhost fallback lives only in drizzle.config.ts for dev tooling).
 */
export function getDb(): Db {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        '@vividpages/db: DATABASE_URL is not set. ' +
          'Set it to a Postgres connection string, e.g. postgres://user:pass@host:5432/dbname.',
      );
    }
    pool = new pg.Pool({ connectionString });
    instance = drizzle(pool, { schema, casing: 'snake_case' });
  }
  return instance;
}

/**
 * Ends the pg Pool and resets the singleton so workers/tests can shut down
 * gracefully. Safe to call when no pool was ever created.
 */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  instance = undefined;
  if (p) {
    await p.end();
  }
}
