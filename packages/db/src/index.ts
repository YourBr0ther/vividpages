import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export * from './schema';
export { schema };

export type Db = NodePgDatabase<typeof schema>;

function createDb(): Db {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://vividpages:vividpages@localhost:5432/vividpages',
  });
  return drizzle(pool, { schema, casing: 'snake_case' });
}

let instance: Db | undefined;

/**
 * Lazy singleton: the pg Pool is only created on first use, so importing this
 * package (e.g. from drizzle.config.ts or build-time code) never opens
 * connections.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= createDb();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
