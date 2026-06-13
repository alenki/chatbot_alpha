// Custom migration runner for the provisioned Supabase database.
//
// Why this exists (and not `drizzle-kit migrate`):
//   drizzle-orm's built-in migrator unconditionally runs
//   `CREATE SCHEMA IF NOT EXISTS <migrationsSchema>` before creating its
//   bookkeeping table. On this Supabase project the app role (chatbot_app) has
//   CREATE on the `public` schema but NOT CREATE on the `postgres` database, so
//   even `CREATE SCHEMA IF NOT EXISTS public` fails with 42501 (Postgres checks
//   the db-level CREATE privilege before the IF NOT EXISTS short-circuit). The
//   role CAN create tables in `public`, so we keep the standard
//   `public.__drizzle_migrations` bookkeeping table and apply the SAME generated
//   drizzle migration files — just skipping the CREATE SCHEMA step.
//
// The bookkeeping format (hash = sha256 of the raw .sql file, created_at = the
// journal `when`) is identical to drizzle-orm's, so the table stays compatible
// with the official migrator if a future environment grants the needed privilege.
//
// Usage: node scripts/migrate.mjs [--test]
//   default → DATABASE_URL, --test → TEST_DATABASE_URL
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const here = dirname(fileURLToPath(import.meta.url))
try {
  process.loadEnvFile(resolve(here, '../../.env'))
} catch {
  // .env optional (CI injects env directly).
}

const useTest = process.argv.includes('--test')
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL
if (!url) {
  console.error(`Missing ${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} in environment`)
  process.exit(1)
}

const migrationsFolder = resolve(here, '../drizzle')
const migrations = readMigrationFiles({ migrationsFolder })

const pool = new pg.Pool({ connectionString: url })
const client = await pool.connect()
try {
  // Bookkeeping table in `public` (role has CREATE on public). No CREATE SCHEMA.
  await client.query(
    `CREATE TABLE IF NOT EXISTS "public"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY,
       hash text NOT NULL,
       created_at bigint
     )`,
  )

  const { rows } = await client.query(
    `select id, hash, created_at from "public"."__drizzle_migrations" order by created_at desc limit 1`,
  )
  const lastDbMigration = rows[0]

  let applied = 0
  for (const migration of migrations) {
    if (lastDbMigration && Number(lastDbMigration.created_at) >= migration.folderMillis) {
      continue
    }
    await client.query('BEGIN')
    try {
      for (const stmt of migration.sql) {
        const trimmed = stmt.trim()
        if (trimmed.length === 0) continue
        await client.query(trimmed)
      }
      await client.query(
        `insert into "public"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)`,
        [migration.hash, migration.folderMillis],
      )
      await client.query('COMMIT')
      applied++
      console.log(`applied migration (created_at=${migration.folderMillis})`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  }
  console.log(
    `migrations done → ${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} (${applied} applied, ${migrations.length} total)`,
  )
} finally {
  client.release()
  await pool.end()
}
