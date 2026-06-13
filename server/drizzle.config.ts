import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit does NOT auto-load the root .env. Node's process.loadEnvFile does.
// The repo-root .env holds the working Supabase DATABASE_URL/TEST_DATABASE_URL;
// without this the localhost fallback below is used and migrate/generate fails.
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../.env'))
} catch {
  // .env optional (e.g. CI injects env directly); ignore when absent.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // The provisioned Supabase role (chatbot_app) has CREATE on the `public` schema
  // but NOT on the `postgres` database, so it cannot create drizzle-kit's default
  // `drizzle` bookkeeping schema (CREATE SCHEMA needs CREATE-on-database). Keeping
  // the __drizzle_migrations table in `public` (where the role can create tables)
  // is the documented way to relocate it. Migrations themselves are idempotent.
  migrations: { schema: 'public' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/chatbot',
  },
})
