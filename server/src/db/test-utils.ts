import { sql } from 'drizzle-orm'
import { createDb, type Db } from './client.js'

let testDb: Db | undefined

export function getTestDb(): Db {
  if (!testDb) {
    testDb = createDb(
      process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/chatbot_test',
    )
  }
  return testDb
}

export async function resetDb(db: Db = getTestDb()): Promise<void> {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  )
  const tables = result.rows.map((row) => String(row.tablename))
  if (tables.length === 0) return
  const list = tables.map((t) => `"public"."${t}"`).join(', ')
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`))
}
