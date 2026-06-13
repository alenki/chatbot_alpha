import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'

// Same as drizzle.config.ts but targets TEST_DATABASE_URL. A separate config file
// (selected with --config) is the cross-platform way to point `drizzle-kit migrate`
// at the test database without shell-specific `VAR=x cmd` syntax (breaks on Windows).
// drizzle-kit does NOT auto-load the root .env; Node's process.loadEnvFile does.
try {
  process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../.env'))
} catch {
  // .env optional (e.g. CI injects env directly); ignore when absent.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // See drizzle.config.ts: standard `drizzle` bookkeeping schema (survives resetDb,
  // which only truncates `public`).
  dbCredentials: {
    url: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/chatbot_test',
    ssl: { rejectUnauthorized: false },
  },
})
