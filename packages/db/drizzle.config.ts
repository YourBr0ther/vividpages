import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://vividpages:vividpages@localhost:5432/vividpages',
  },
});
