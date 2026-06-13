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
  // Standard drizzle bookkeeping: __drizzle_migrations lives in the default
  // `drizzle` schema. The chatbot_app role now has CREATE on the database, so
  // drizzle's `CREATE SCHEMA IF NOT EXISTS drizzle` succeeds. Keeping it out of
  // `public` is intentional — resetDb only truncates `public`, so the bookkeeping
  // table survives test resets.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/chatbot',
    // Supabase pooler presents a chain pg cannot verify; the URL carries
    // sslmode=no-verify but drizzle-kit's pg connection needs this explicitly.
    ssl: { rejectUnauthorized: false },
  },
})
