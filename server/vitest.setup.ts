// Loads the repository-root .env into process.env before tests run.
// This project uses a cloud Supabase Postgres (not the docker-compose default),
// so TEST_DATABASE_URL / DATABASE_URL must reach the test workers. We use Node's
// built-in env-file loader to avoid adding a dotenv dependency.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
try {
  // Available in Node >= 20.12 / 22.
  process.loadEnvFile(resolve(here, '../.env'))
} catch {
  // .env is optional (e.g. CI injects env directly); ignore when absent.
}
